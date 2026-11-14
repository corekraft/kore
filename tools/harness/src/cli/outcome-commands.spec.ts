import { beforeEach, describe, expect, it, vi } from "vitest";
import { IdeaError, IdeaRepository } from "../idea/index.js";
import {
  closeOutcome,
  labelFor,
  parseOutcome,
  recordOutcome,
  type Concluded,
} from "../outcome/index.js";
import type { LedgerEvent, RecordResult } from "../ledger/index.js";
import { contextWith, fakeLedger } from "./command-support.js";
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

/** The outcome parseOutcome returns for the record flags below; a fixture, not behaviour. */
function parsedOutcome() {
  return {
    kind: "experiment",
    source: "comparison",
    result: "confirmed",
    evidence: "kore local up p50 41s before, 29s after",
    summary: "Up time fell from 41s to 29s.",
  } as ReturnType<typeof parseOutcome>;
}

/** The deps a command reads, every one a fake the spec can assert on. */
function fakeDeps() {
  return {
    root: vi.fn(() => Promise.resolve(ROOT)),
    runner: { run: vi.fn() },
    clock: {
      now: vi.fn(() => new Date("2026-11-14T08:30:00Z")),
      sleep: vi.fn(() => Promise.resolve()),
    },
    fs: {},
    stdout: vi.fn<(text: string) => void>(),
    stderr: vi.fn<(text: string) => void>(),
  };
}

/** A context for `outcome record` or `outcome close` with the given flags. */
function context(options: Record<string, string | boolean>, json = false) {
  const deps = fakeDeps();
  return { ctx: contextWith(deps, options, json), deps };
}

/** Makes the ledger the command opens: its list and record are mocks. */
function withLedger(
  listed: Partial<LedgerEvent>[] = [],
  record: RecordResult = { ok: true, event: STORED },
) {
  const ledger = fakeLedger(listed, record);
  vi.mocked(openLedger).mockResolvedValue({ ledger: ledger.ledger });
  return ledger;
}

const RECORD_FLAGS = {
  idea: "1",
  kind: "experiment",
  source: "comparison",
  evidence: "kore local up p50 41s before, 29s after",
  result: "confirmed",
  summary: "Up time fell from 41s to 29s.",
};

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

beforeEach(() => {
  withLedger();
  vi.mocked(labelFor).mockImplementation((r) => `outcome:${r}`);
  vi.mocked(parseOutcome).mockReturnValue(parsedOutcome());
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
      parsedOutcome(),
    );
    expect(deps.stdout).toHaveBeenCalledWith(
      "Idea 0001 confirmed; issue closed: https://github.com/corekraft/kore/issues/300\n",
    );
  });

  it("logs one ledger event for the idea, labelled by its result and numbered by its issue", async () => {
    const ledger = withLedger();
    const { ctx } = context(RECORD_FLAGS);
    expect(await outcomeCommands.record?.run(ctx)).toBe(0);
    expect(ledger.list).toHaveBeenCalledWith({ idea: "0001", kind: "outcome" });
    expect(ledger.write).toHaveBeenCalledWith({
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
    const ledger = withLedger([STORED]);
    const { ctx } = context(RECORD_FLAGS);
    expect(await outcomeCommands.record?.run(ctx)).toBe(0);
    expect(ledger.write).not.toHaveBeenCalled();
  });

  it("fails after publishing when the ledger rejects the event, naming how to repair it", async () => {
    withLedger([], { ok: false, field: "label", message: "disk full." });
    const { ctx, deps } = context(RECORD_FLAGS);
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
