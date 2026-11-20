import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DecisionError,
  decisionFlagOn,
  makeDecision,
  type DecisionPorts,
  type Made,
} from "../decision/index.js";
import {
  IdeaError,
  IdeaRepository,
  issueTarget,
  numberedIssue,
} from "../idea/index.js";
import type { LedgerEvent } from "../ledger/index.js";
import { contextWith, fakeLedger } from "./command-support.js";
import { decisionCommands } from "./decision-commands.js";
import { openLedger } from "./ledger-commands.js";

vi.mock("../decision/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../decision/index.js")>()),
  decisionFlagOn: vi.fn(),
  makeDecision: vi.fn(),
}));
vi.mock("../idea/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../idea/index.js")>()),
  IdeaRepository: vi.fn(),
  issueTarget: vi.fn(),
  numberedIssue: vi.fn(),
}));
vi.mock("./ledger-commands.js");

const ROOT = "/repo";
const FLAGS = {
  idea: "8",
  category: "naming",
  question: "Median or P50?",
  decision: "Median.",
};
const ISSUE_URL = "https://github.com/corekraft/kore/issues/1435";
const ISSUE_FLAGS = {
  issue: "1435",
  category: "naming",
  question: "Median or P50?",
  decision: "Median.",
};
const MADE_ON_ISSUE: Made = {
  category: "naming",
  issue: ISSUE_URL,
  commentUrl: "https://github.com/corekraft/kore/issues/1435#c1",
};
const MADE: Made = {
  idea: "0008",
  category: "naming",
  issue: "https://github.com/corekraft/kore/issues/795",
  commentUrl: "https://github.com/corekraft/kore/issues/795#c1",
};
const ENV = { KORE_ROLE: "advisor", KORE_AGENT: "advise-x" };

function fakeDeps(run = vi.fn()) {
  return {
    root: vi.fn(() => Promise.resolve(ROOT)),
    runner: { run },
    clock: {
      now: vi.fn(() => new Date("2026-11-16T10:00:00Z")),
      sleep: vi.fn(() => Promise.resolve()),
    },
    fs: {},
    stdout: vi.fn<(text: string) => void>(),
    stderr: vi.fn<(text: string) => void>(),
    env: ENV,
  };
}

function context(
  options: Record<string, string | boolean>,
  json = false,
  run = vi.fn(),
) {
  const deps = fakeDeps(run);
  return { ctx: contextWith(deps, options, json), deps };
}

/** The ports the command handed to makeDecision. */
function portsOf(): DecisionPorts {
  return vi.mocked(makeDecision).mock.calls[0]?.[0] as DecisionPorts;
}

beforeEach(() => {
  vi.mocked(makeDecision).mockResolvedValue(MADE);
  vi.mocked(openLedger).mockResolvedValue({ ledger: fakeLedger().ledger });
});

describe("decision make", () => {
  it("makes the decision from the flags and reports where it was posted", async () => {
    const { ctx, deps } = context(FLAGS);

    expect(await decisionCommands["make"]?.run(ctx)).toBe(0);

    expect(makeDecision).toHaveBeenCalledWith(expect.anything(), {
      idea: "8",
      category: "naming",
      question: "Median or P50?",
      decision: "Median.",
    });
    expect(deps.stdout).toHaveBeenCalledWith(
      "Recorded a naming decision for idea 0008: https://github.com/corekraft/kore/issues/795#c1\n",
    );
  });

  it("prints the decision as one JSON line with --json", async () => {
    const { ctx, deps } = context(FLAGS, true);

    await decisionCommands["make"]?.run(ctx);

    expect(deps.stdout).toHaveBeenCalledWith(`${JSON.stringify(MADE)}\n`);
  });

  it("reads the sender line's environment and the flag from the spawn environment and the local overlay", async () => {
    const { ctx, deps } = context(FLAGS);
    vi.mocked(decisionFlagOn).mockResolvedValue(true);

    await decisionCommands["make"]?.run(ctx);

    expect(portsOf().env).toBe(ENV);
    expect(await portsOf().flagOn()).toBe(true);
    expect(decisionFlagOn).toHaveBeenCalledWith(deps.fs, ROOT);
  });
});

describe("decision make ports", () => {
  it("resolves the idea to its number and its issue", async () => {
    const { ctx, deps } = context(FLAGS);
    const get = vi.fn(() => Promise.resolve({ number: "0008" }));
    vi.mocked(IdeaRepository).mockImplementation(function () {
      return { get } as unknown as IdeaRepository;
    });
    vi.mocked(issueTarget).mockResolvedValue({
      number: "795",
      repo: "corekraft/kore",
    });

    await decisionCommands["make"]?.run(ctx);

    expect(await portsOf().target("8")).toEqual({
      idea: "0008",
      number: "795",
      repo: "corekraft/kore",
    });
    expect(IdeaRepository).toHaveBeenCalledWith(deps.fs, deps.clock, ROOT);
    expect(get).toHaveBeenCalledWith("8");
    expect(issueTarget).toHaveBeenCalledWith(deps.runner, ROOT, {
      number: "0008",
    });
  });

  it("posts the comment with gh on the issue and returns its URL", async () => {
    const run = vi.fn(() =>
      Promise.resolve({ code: 0, stdout: "URL\n", stderr: "" }),
    );
    const { ctx } = context(FLAGS, false, run);

    await decisionCommands["make"]?.run(ctx);
    const url = await portsOf().post(
      { number: "795", repo: "corekraft/kore" },
      "BODY",
    );

    expect(url).toBe("URL");
    expect(run).toHaveBeenCalledWith(
      "gh",
      ["issue", "comment", "795", "--repo", "corekraft/kore", "--body", "BODY"],
      { cwd: ROOT },
    );
  });

  it("fails with gh's reason when the comment is not posted", async () => {
    const run = vi.fn(() =>
      Promise.resolve({ code: 1, stdout: "", stderr: "not logged in\n" }),
    );
    const { ctx } = context(FLAGS, false, run);

    await decisionCommands["make"]?.run(ctx);

    await expect(
      portsOf().post({ number: "795", repo: "r/k" }, "BODY"),
    ).rejects.toThrow(
      "gh issue comment failed for issue #795: not logged in. Check `gh auth status`, then rerun the same command.",
    );
  });
});

describe("decision make ledger port", () => {
  it("records decision.made from claude with the idea, its issue number and the category", async () => {
    const ledger = fakeLedger([], {
      ok: true,
      event: {} as LedgerEvent,
    });
    vi.mocked(openLedger).mockResolvedValue({ ledger: ledger.ledger });
    const { ctx } = context(FLAGS);

    await decisionCommands["make"]?.run(ctx);
    const recorded = await portsOf().record({
      idea: "0008",
      label: "naming",
      number: 795,
    });

    expect(recorded).toEqual({ ok: true });
    expect(ledger.write).toHaveBeenCalledWith({
      source: "claude",
      kind: "decision.made",
      occurredAt: "2026-11-16T10:00:00.000Z",
      idea: "0008",
      label: "naming",
      number: 795,
    });
  });

  it("passes the ledger's rejection back as a message", async () => {
    const ledger = fakeLedger([], {
      ok: false,
      field: "label",
      message: "bad label",
    });
    vi.mocked(openLedger).mockResolvedValue({ ledger: ledger.ledger });
    const { ctx } = context(FLAGS);

    await decisionCommands["make"]?.run(ctx);

    expect(
      await portsOf().record({ idea: "0008", label: "x", number: 795 }),
    ).toEqual({
      ok: false,
      message: "bad label",
    });
  });
});

describe("decision make failures", () => {
  it("prints a refusal as the command's message and exits 1", async () => {
    vi.mocked(makeDecision).mockRejectedValue(new DecisionError("reserved"));
    const { ctx, deps } = context(FLAGS);

    expect(await decisionCommands["make"]?.run(ctx)).toBe(1);

    expect(deps.stderr).toHaveBeenCalledWith("reserved\n");
    expect(deps.stdout).not.toHaveBeenCalled();
  });

  it("puts a JSON error first under --json", async () => {
    vi.mocked(makeDecision).mockRejectedValue(new IdeaError("no issue"));
    const { ctx, deps } = context(FLAGS, true);

    expect(await decisionCommands["make"]?.run(ctx)).toBe(1);

    expect(deps.stderr).toHaveBeenCalledWith(
      `${JSON.stringify({ error: "no issue" })}\nno issue\n`,
    );
  });

  it("rethrows an error it does not expect", async () => {
    vi.mocked(makeDecision).mockRejectedValue(new TypeError("bug"));
    const { ctx } = context(FLAGS);

    await expect(decisionCommands["make"]?.run(ctx)).rejects.toThrow("bug");
  });

  it("fails before posting when the ledger cannot be opened", async () => {
    vi.mocked(openLedger).mockResolvedValue({ error: "no ledger" });
    const { ctx, deps } = context(FLAGS);

    expect(await decisionCommands["make"]?.run(ctx)).toBe(1);

    expect(makeDecision).not.toHaveBeenCalled();
    expect(deps.stderr).toHaveBeenCalledWith("no ledger\n");
  });

  it("is a usage error, calling nothing, when neither --idea nor --issue is given", async () => {
    const { ctx, deps } = context({ ...FLAGS, idea: "" });

    expect(await decisionCommands["make"]?.run(ctx)).toBe(2);

    expect(makeDecision).not.toHaveBeenCalled();
    expect(deps.stderr).toHaveBeenCalledWith(
      "Missing --idea or --issue; run `harness decision make (--idea <number or slug> | --issue <number>) --category <name> --question <text> --decision <text>`.\n",
    );
  });
});

describe("decision make for a plain ticket", () => {
  it("makes the decision on a plain ticket from --issue, with no idea", async () => {
    vi.mocked(makeDecision).mockResolvedValue(MADE_ON_ISSUE);
    const { ctx, deps } = context(ISSUE_FLAGS);

    expect(await decisionCommands["make"]?.run(ctx)).toBe(0);

    expect(makeDecision).toHaveBeenCalledWith(expect.anything(), ISSUE_FLAGS);
    expect(vi.mocked(makeDecision).mock.calls[0]?.[1]).not.toHaveProperty(
      "idea",
    );
    expect(deps.stdout).toHaveBeenCalledWith(
      `Recorded a naming decision for the issue at ${ISSUE_URL}: ${MADE_ON_ISSUE.commentUrl}\n`,
    );
  });

  it("resolves a plain ticket's issue number through the repository gh reports", async () => {
    vi.mocked(numberedIssue).mockResolvedValue({
      number: "1435",
      repo: "corekraft/kore",
    });
    const { ctx, deps } = context(ISSUE_FLAGS);

    await decisionCommands["make"]?.run(ctx);

    expect(await portsOf().issue("1435")).toEqual({
      number: "1435",
      repo: "corekraft/kore",
    });
    expect(numberedIssue).toHaveBeenCalledWith(deps.runner, ROOT, "1435");
  });

  it("records a plain ticket's decision.made with the issue number and category, and no idea", async () => {
    const ledger = fakeLedger([], { ok: true, event: {} as LedgerEvent });
    vi.mocked(openLedger).mockResolvedValue({ ledger: ledger.ledger });
    const { ctx } = context(ISSUE_FLAGS);

    await decisionCommands["make"]?.run(ctx);
    expect(await portsOf().record({ label: "naming", number: 1435 })).toEqual({
      ok: true,
    });

    const written = ledger.write.mock.calls[0]?.[0];
    expect(written).toEqual({
      source: "claude",
      kind: "decision.made",
      occurredAt: "2026-11-16T10:00:00.000Z",
      label: "naming",
      number: 1435,
    });
    expect(written).not.toHaveProperty("idea");
  });

  it("declares no --role flag, so a role cannot be supplied by hand", () => {
    expect(Object.keys(decisionCommands["make"]?.options ?? {})).toEqual([
      "idea",
      "issue",
      "category",
      "question",
      "decision",
      "ledger",
    ]);
  });
});
