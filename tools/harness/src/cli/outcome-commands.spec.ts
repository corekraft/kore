import { beforeEach, describe, expect, it, vi } from "vitest";
import { IdeaError, IdeaRepository } from "../idea/index.js";
import {
  closeOutcome,
  labelFor,
  parseOutcome,
  recordOutcome,
  type Concluded,
} from "../outcome/index.js";
import type { CliDeps, CommandContext } from "../runtime/index.js";
import type { Ledger, LedgerEvent } from "../ledger/index.js";
import { openLedger } from "./ledger-commands.js";
import { outcomeCommands } from "./outcome-commands.js";

vi.mock("../idea/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../idea/index.js")>()),
  IdeaRepository: vi.fn(),
}));
vi.mock("../outcome/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../outcome/index.js")>()),
  closeOutcome: vi.fn(),
  labelFor: vi.fn(),
  parseOutcome: vi.fn(),
  recordOutcome: vi.fn(),
}));
vi.mock("./ledger-commands.js");

const ROOT = "/repo";
const CONCLUDED: Concluded = {
  idea: "0001",
  result: "confirmed",
  issue: "https://github.com/corekraft/kore/issues/300",
  published: { commented: true, labelled: true, closed: true },
};
const PARSED = {
  kind: "experiment",
  source: "comparison",
  result: "confirmed",
  evidence: "kore local up p50 41s before, 29s after",
  summary: "Up time fell from 41s to 29s.",
} as ReturnType<typeof parseOutcome>;

/** The deps a command reads: a root, a runner, a clock and two output streams, all fakes. */
function fakeDeps() {
  const deps = {
    root: vi.fn(() => Promise.resolve(ROOT)),
    runner: { run: vi.fn() },
    clock: {
      now: vi.fn(() => new Date("2026-11-14T08:30:00Z")),
      sleep: vi.fn(() => Promise.resolve()),
    },
    fs: {},
    stdout: vi.fn(),
    stderr: vi.fn(),
  };
  return deps as typeof deps & CliDeps;
}

/** A context for `outcome record` or `outcome close` with the given flags. */
function context(
  options: Record<string, string | boolean>,
  json = false,
): { ctx: CommandContext; deps: ReturnType<typeof fakeDeps> } {
  const deps = fakeDeps();
  return { ctx: { json, options, deps }, deps };
}

const RECORD_FLAGS = {
  idea: "1",
  kind: "experiment",
  source: "comparison",
  evidence: "kore local up p50 41s before, 29s after",
  result: "confirmed",
  summary: "Up time fell from 41s to 29s.",
};

/** An event as the ledger stores it: the outcome that was just recorded. */
const STORED: LedgerEvent = {
  schema: 1,
  id: "e1",
  recordedAt: "2026-11-14T08:30:00.000Z",
  source: "github",
  kind: "outcome",
  occurredAt: "2026-11-14T08:30:00.000Z",
  idea: "0001",
  label: "outcome:confirmed",
  number: 300,
};

/** A ledger whose list and record are mocks; the one cast stands in for the rest of the class. */
function fakeLedger() {
  const list = vi.fn<Ledger["list"]>(() =>
    Promise.resolve({ events: [], skipped: 0 }),
  );
  const record = vi.fn<Ledger["record"]>(() =>
    Promise.resolve({ ok: true, event: STORED }),
  );
  return { ledger: { list, record } as unknown as Ledger, list, record };
}

let ledger: ReturnType<typeof fakeLedger>;

beforeEach(() => {
  ledger = fakeLedger();
  vi.mocked(openLedger).mockResolvedValue({ ledger: ledger.ledger });
  vi.mocked(labelFor).mockImplementation((r) => `outcome:${r}`);
  vi.mocked(parseOutcome).mockReturnValue(PARSED);
  vi.mocked(recordOutcome).mockResolvedValue(CONCLUDED);
  vi.mocked(closeOutcome).mockResolvedValue(CONCLUDED);
});

describe("outcome record", () => {
  it("parses the flags, records the outcome, and reports the issue it closed", async () => {
    const { ctx, deps } = context(RECORD_FLAGS);
    expect(await outcomeCommands.record?.run(ctx)).toBe(0);
    expect(parseOutcome).toHaveBeenCalledWith({
      kind: "experiment",
      source: "comparison",
      result: "confirmed",
      evidence: "kore local up p50 41s before, 29s after",
      summary: "Up time fell from 41s to 29s.",
    });
    expect(IdeaRepository).toHaveBeenCalledWith(deps.fs, deps.clock, ROOT);
    expect(recordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        runner: deps.runner,
        clock: deps.clock,
        root: ROOT,
      }),
      "1",
      PARSED,
    );
    expect(deps.stdout).toHaveBeenCalledWith(
      "Idea 0001 confirmed; issue closed: https://github.com/corekraft/kore/issues/300\n",
    );
  });

  it("logs one ledger event for the idea, labelled by its result and numbered by its issue", async () => {
    const { ctx } = context(RECORD_FLAGS);
    expect(await outcomeCommands.record?.run(ctx)).toBe(0);
    expect(ledger.list).toHaveBeenCalledWith({ idea: "0001", kind: "outcome" });
    expect(ledger.record).toHaveBeenCalledWith({
      source: "github",
      kind: "outcome",
      occurredAt: "2026-11-14T08:30:00.000Z",
      idea: "0001",
      label: "outcome:confirmed",
      number: 300,
    });
  });
});

describe("outcome record output and ledger", () => {
  it("prints the concluded outcome as one JSON line with --json", async () => {
    const { ctx, deps } = context(RECORD_FLAGS, true);
    expect(await outcomeCommands.record?.run(ctx)).toBe(0);
    expect(deps.stdout).toHaveBeenCalledWith(`${JSON.stringify(CONCLUDED)}\n`);
  });

  it("names the follow-up idea in the text output when the outcome has one", async () => {
    const { ctx, deps } = context(RECORD_FLAGS);
    vi.mocked(recordOutcome).mockResolvedValue({
      ...CONCLUDED,
      result: "refuted",
      followUp: "docs/ideas/0002-follow-up-0001-cache-the-probe-results.md",
    });
    await outcomeCommands.record?.run(ctx);
    expect(deps.stdout).toHaveBeenCalledWith(
      "Idea 0001 refuted; issue closed: https://github.com/corekraft/kore/issues/300\nFollow-up idea: docs/ideas/0002-follow-up-0001-cache-the-probe-results.md\n",
    );
  });

  it("does not log a second ledger event when the idea already has one", async () => {
    const { ctx } = context(RECORD_FLAGS);
    ledger.list.mockResolvedValue({ events: [STORED], skipped: 0 });
    expect(await outcomeCommands.record?.run(ctx)).toBe(0);
    expect(ledger.record).not.toHaveBeenCalled();
  });

  it("fails after publishing when the ledger rejects the event, naming how to repair it", async () => {
    const { ctx, deps } = context(RECORD_FLAGS);
    ledger.record.mockResolvedValue({
      ok: false,
      field: "label",
      message: "disk full.",
    });
    expect(await outcomeCommands.record?.run(ctx)).toBe(1);
    expect(deps.stderr).toHaveBeenCalledWith(
      "The outcome was published, but its ledger event was rejected: disk full. Fix the ledger, then rerun `harness outcome close --idea 0001` to record the event.\n",
    );
    expect(deps.stdout).not.toHaveBeenCalled();
  });
});

describe("outcome record refusals", () => {
  it("refuses a missing --idea before any repository or ledger work", async () => {
    const { ctx, deps } = context({ ...RECORD_FLAGS, idea: "  " });
    expect(await outcomeCommands.record?.run(ctx)).toBe(1);
    expect(deps.stderr).toHaveBeenCalledWith(
      "Missing --idea; run `harness outcome record --idea <number or slug>`, or `harness idea list` to see the ideas.\n",
    );
    expect(recordOutcome).not.toHaveBeenCalled();
  });

  it("prints the error as JSON as well when --json is set", async () => {
    const { ctx, deps } = context({ ...RECORD_FLAGS, idea: "" }, true);
    expect(await outcomeCommands.record?.run(ctx)).toBe(1);
    const message =
      "Missing --idea; run `harness outcome record --idea <number or slug>`, or `harness idea list` to see the ideas.";
    expect(deps.stderr).toHaveBeenCalledWith(
      `${JSON.stringify({ error: message })}\n${message}\n`,
    );
  });

  it("fails before any write when the ledger cannot be opened", async () => {
    const { ctx, deps } = context(RECORD_FLAGS);
    vi.mocked(openLedger).mockResolvedValue({ error: "no ledger here" });
    expect(await outcomeCommands.record?.run(ctx)).toBe(1);
    expect(deps.stderr).toHaveBeenCalledWith("no ledger here\n");
    expect(recordOutcome).not.toHaveBeenCalled();
  });

  it("names the failure to find the repository root, and writes nothing", async () => {
    const { ctx, deps } = context(RECORD_FLAGS);
    deps.root.mockRejectedValue(new Error("no repository above /tmp"));
    expect(await outcomeCommands.record?.run(ctx)).toBe(1);
    expect(deps.stderr).toHaveBeenCalledWith("no repository above /tmp\n");
    expect(recordOutcome).not.toHaveBeenCalled();
  });

  it("rethrows an error that is not an IdeaError", async () => {
    const { ctx } = context(RECORD_FLAGS);
    vi.mocked(parseOutcome).mockImplementation(() => {
      throw new TypeError("bug");
    });
    await expect(outcomeCommands.record?.run(ctx)).rejects.toThrow(
      new TypeError("bug"),
    );
  });

  it("reports a parse refusal as an IdeaError message and exit 1", async () => {
    const { ctx, deps } = context(RECORD_FLAGS);
    vi.mocked(parseOutcome).mockImplementation(() => {
      throw new IdeaError("Missing --kind; pass one of experiment.");
    });
    expect(await outcomeCommands.record?.run(ctx)).toBe(1);
    expect(deps.stderr).toHaveBeenCalledWith(
      "Missing --kind; pass one of experiment.\n",
    );
  });
});

describe("outcome close", () => {
  it("closes the idea's recorded outcome without parsing any outcome flags", async () => {
    const { ctx, deps } = context({ idea: "1" });
    expect(await outcomeCommands.close?.run(ctx)).toBe(0);
    expect(parseOutcome).not.toHaveBeenCalled();
    expect(recordOutcome).not.toHaveBeenCalled();
    expect(closeOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ root: ROOT, runner: deps.runner }),
      "1",
    );
    expect(deps.stdout).toHaveBeenCalledWith(
      "Idea 0001 confirmed; issue closed: https://github.com/corekraft/kore/issues/300\n",
    );
  });

  it("refuses a missing --idea with the close command in the message", async () => {
    const { ctx, deps } = context({});
    expect(await outcomeCommands.close?.run(ctx)).toBe(1);
    expect(deps.stderr).toHaveBeenCalledWith(
      "Missing --idea; run `harness outcome close --idea <number or slug>`, or `harness idea list` to see the ideas.\n",
    );
    expect(closeOutcome).not.toHaveBeenCalled();
  });
});
