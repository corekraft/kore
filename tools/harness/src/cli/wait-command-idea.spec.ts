import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandContext } from "../runtime/index.js";
import { parseTimeout } from "../session/index.js";
import { failed, repoOf } from "./judge-shared.js";
import { readChecks, type ChecksReport } from "./pr-checks.js";
import { harnessWait } from "./wait-command.js";
import { ideaWaits, readIdeaTarget } from "./wait-idea-target.js";

vi.mock("./wait-idea-target.js", () => ({
  ideaWaits: vi.fn(),
  readIdeaTarget: vi.fn(),
}));
vi.mock("../session/index.js", () => ({
  openSessionTarget: vi.fn(),
  parseTimeout: vi.fn(),
  settleSessionTarget: vi.fn(),
}));
vi.mock("./judge-shared.js", () => ({
  failed: vi.fn(),
  repoOf: vi.fn(),
}));
vi.mock("./pr-checks.js", () => ({
  CHECKS_POLL_MS: 15_000,
  readChecks: vi.fn(),
}));

const SINCE = "2026-01-02T03:04:05.000Z";

/** A context whose clock moves only when the wait sleeps, and the stdout and stderr it writes. */
function fixture(
  lists: Record<string, string[]>,
  options: Record<string, string | boolean> = {},
  json = false,
) {
  let elapsed = 0;
  const stdout = vi.fn<(text: string) => void>();
  const stderr = vi.fn<(text: string) => void>();
  const sleep = vi.fn((ms: number) => {
    elapsed += ms;
    return Promise.resolve();
  });
  const context = {
    json,
    options,
    lists,
    deps: {
      runner: { run: vi.fn() },
      clock: {
        now: () => new Date(Date.parse(SINCE) + elapsed),
        sleep,
      },
      root: () => Promise.resolve("/repo"),
      stdout,
      stderr,
    },
  } as unknown as CommandContext;
  return { context, stdout, stderr, sleep };
}

function report(state: ChecksReport["state"]): ChecksReport {
  return { state, checks: [], failed: [], pending: [] };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(repoOf).mockResolvedValue("corekraft/kore");
  vi.mocked(failed).mockReturnValue(1);
  vi.mocked(parseTimeout).mockReturnValue(3_600_000);
  vi.mocked(ideaWaits).mockImplementation((names, anyIdea) => ({
    waits: anyIdea ? [{ idea: undefined }] : names.map((idea) => ({ idea })),
  }));
});

describe("harness wait refuses an idea target it cannot run, before it reads anything", () => {
  it("refuses the usage the idea flags give, with exit 2, and reads nothing", async () => {
    vi.mocked(ideaWaits).mockReturnValue({
      usage:
        'Invalid --idea "bad name": give an idea name, such as --idea 0007 or --idea #7.',
    });
    const f = fixture({ idea: ["bad name"] });

    expect(await harnessWait.run(f.context)).toBe(2);
    expect(f.stderr).toHaveBeenCalledExactlyOnceWith(
      'Invalid --idea "bad name": give an idea name, such as --idea 0007 or --idea #7.\n',
    );
    expect(readIdeaTarget).not.toHaveBeenCalled();
  });

  it("refuses --idea and --any-idea together, with exit 2 and nothing read", async () => {
    vi.mocked(ideaWaits).mockReturnValue({
      usage:
        "Give either --idea <name> or --any-idea, not both: --idea waits on one idea, --any-idea on any.",
    });
    const f = fixture({ idea: ["0007"] }, { "any-idea": true });

    expect(await harnessWait.run(f.context)).toBe(2);
    expect(f.stderr).toHaveBeenCalledExactlyOnceWith(
      "Give either --idea <name> or --any-idea, not both: --idea waits on one idea, --any-idea on any.\n",
    );
    expect(readIdeaTarget).not.toHaveBeenCalled();
  });
});

describe("harness wait settles on an idea's state change", () => {
  it("names a named idea and its new state, and reads changes from when the wait began", async () => {
    vi.mocked(readIdeaTarget).mockResolvedValue({
      kind: "settled",
      idea: "0007",
      state: "outcome:confirmed",
    });
    const f = fixture({ idea: ["0007"] });

    expect(await harnessWait.run(f.context)).toBe(0);
    expect(f.stdout).toHaveBeenCalledExactlyOnceWith(
      "settled: idea 0007 is now outcome:confirmed.\n",
    );
    expect(readIdeaTarget).toHaveBeenCalledWith(
      f.context.deps,
      { idea: "0007" },
      SINCE,
    );
  });

  it("settles on any idea's state change and names the idea that moved", async () => {
    vi.mocked(readIdeaTarget).mockResolvedValue({
      kind: "settled",
      idea: "#7",
      state: "approved",
    });
    const f = fixture({}, { "any-idea": true });

    expect(await harnessWait.run(f.context)).toBe(0);
    expect(f.stdout).toHaveBeenCalledExactlyOnceWith(
      "settled: idea #7 is now approved.\n",
    );
    expect(readIdeaTarget).toHaveBeenCalledWith(
      f.context.deps,
      { idea: undefined },
      SINCE,
    );
  });

  it("returns on the first to settle between an idea and a pull request, and leaves the rest to restart", async () => {
    vi.mocked(readChecks).mockResolvedValue(report("pending"));
    vi.mocked(readIdeaTarget).mockResolvedValue({
      kind: "settled",
      idea: "0007",
      state: "reserved",
    });
    const f = fixture({ pr: ["5"], idea: ["0007"] });

    expect(await harnessWait.run(f.context)).toBe(0);
    expect(f.stdout).toHaveBeenCalledExactlyOnceWith(
      "settled: idea 0007 is now reserved.\nRestart harness wait with the rest: --pr 5.\n",
    );
    expect(f.sleep).not.toHaveBeenCalled();
  });
});

describe("harness wait stops at its bound for an idea target, naming it", () => {
  it("exits 3 for a named idea, naming it as pending and the ledger read as its next step", async () => {
    vi.mocked(parseTimeout).mockReturnValue(30_000);
    vi.mocked(readIdeaTarget).mockResolvedValue({ kind: "pending" });
    const f = fixture({ idea: ["0007"] }, { timeout: "30000" });

    expect(await harnessWait.run(f.context)).toBe(3);
    expect(f.stdout).toHaveBeenCalledExactlyOnceWith(
      "harness wait: the bound of 30 seconds passed with nothing settled. Still pending: idea 0007. Next: read the ledger with `harness ledger list --idea 0007`, then restart harness wait with --idea 0007.\n",
    );
  });

  it("names any idea as still pending at the bound, and restarts with --any-idea", async () => {
    vi.mocked(parseTimeout).mockReturnValue(30_000);
    vi.mocked(readIdeaTarget).mockResolvedValue({ kind: "pending" });
    const f = fixture({}, { "any-idea": true, timeout: "30000" });

    expect(await harnessWait.run(f.context)).toBe(3);
    expect(f.stdout).toHaveBeenCalledExactlyOnceWith(
      "harness wait: the bound of 30 seconds passed with nothing settled. Still pending: any idea. Next: read the ledger with `harness ledger list`, then restart harness wait with --any-idea.\n",
    );
  });
});

describe("harness wait --json gives an idea target as one object", () => {
  it("prints a settled named idea with its kind, target, idea and state", async () => {
    vi.mocked(readIdeaTarget).mockResolvedValue({
      kind: "settled",
      idea: "0007",
      state: "outcome:confirmed",
    });
    const f = fixture({ idea: ["0007"] }, {}, true);

    expect(await harnessWait.run(f.context)).toBe(0);
    expect(f.stdout).toHaveBeenCalledExactlyOnceWith(
      '{"outcome":"settled","kind":"idea","target":"0007","idea":"0007","state":"outcome:confirmed","pending":[]}\n',
    );
  });

  it("prints a settled any-idea target, naming the idea that moved", async () => {
    vi.mocked(readIdeaTarget).mockResolvedValue({
      kind: "settled",
      idea: "#7",
      state: "approved",
    });
    const f = fixture({}, { "any-idea": true }, true);

    expect(await harnessWait.run(f.context)).toBe(0);
    expect(f.stdout).toHaveBeenCalledExactlyOnceWith(
      '{"outcome":"settled","kind":"idea","target":"any","idea":"#7","state":"approved","pending":[]}\n',
    );
  });

  it("prints the bound for a named idea as pending, with the next step, and exits 3", async () => {
    vi.mocked(parseTimeout).mockReturnValue(15_000);
    vi.mocked(readIdeaTarget).mockResolvedValue({ kind: "pending" });
    const f = fixture({ idea: ["0007"] }, { timeout: "15000" }, true);

    expect(await harnessWait.run(f.context)).toBe(3);
    expect(f.stdout).toHaveBeenCalledExactlyOnceWith(
      '{"outcome":"bound","pending":[{"kind":"idea","target":"0007"}],"next":"Next: read the ledger with `harness ledger list --idea 0007`, then restart harness wait with --idea 0007."}\n',
    );
  });
});
