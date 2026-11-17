import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventInput, LedgerEvent } from "./schema.js";
import {
  fakeClock,
  fakeFileSystem,
  fakeLedger,
  fakeRunner,
  recordsEverything,
} from "./ledger-support.js";
import { OWNER, REPO, T, defaultSignals } from "./github-signals-support.js";
import { decisionIssues, fromOverturns } from "./github-overturns.js";
import { pollSignals } from "./github-signals.js";

// Factories, not automocks: an automock loads the real module, which the budget charges to each test.
vi.mock("./github-gh.js", () => ({
  DAY_MS: 86_400_000,
  LIMIT: 200,
  asRecord: vi.fn(),
  count: vi.fn(),
  json: vi.fn(),
  list: vi.fn(),
  pages: vi.fn(),
  when: vi.fn(),
}));
vi.mock("./github-owner-actions.js", () => ({ fromActions: vi.fn() }));
vi.mock("./github-overturns.js", () => ({
  decisionIssues: vi.fn(),
  fromOverturns: vi.fn(),
}));
vi.mock("./poll-lock.js", () => ({ acquire: vi.fn() }));

const DECISION: LedgerEvent = {
  schema: 1,
  id: "decision-1",
  source: "claude",
  kind: "decision.made",
  occurredAt: T,
  recordedAt: T,
  idea: "0008",
  label: "naming",
  number: 862,
};

const OVERTURN: EventInput = {
  id: "github:advisor.overturned:9",
  source: "github",
  kind: "advisor.overturned",
  occurredAt: T,
  number: 862,
  idea: "#862",
};

/** One poll over fakes; the ledger answers the decision.made listing with `decisions`. */
function setup(decisions: LedgerEvent[] = []) {
  const runner = fakeRunner();
  const fake = fakeLedger();
  fake.list.mockImplementation((filter) =>
    Promise.resolve({
      events: filter.kind === "decision.made" ? decisions : [],
      skipped: 0,
    }),
  );
  recordsEverything(fake.record);
  const fs = fakeFileSystem();
  const clock = fakeClock();
  const poll = () =>
    pollSignals({
      ledger: fake.ledger,
      runner,
      clock,
      fs,
      repo: REPO,
      owner: OWNER,
    });
  return { runner, fake, fs, clock, poll };
}

beforeEach(() => {
  defaultSignals();
  vi.mocked(decisionIssues).mockReturnValue([]);
  vi.mocked(fromOverturns).mockResolvedValue([]);
});

describe("pollSignals: the owner's replies to advisor decisions", () => {
  it("reads the decisions from the ledger's decision.made events, not a time window", async () => {
    const { fake, poll } = setup();
    await poll();
    expect(fake.list).toHaveBeenCalledWith({ kind: "decision.made" });
  });

  it("reads the comments of each decided issue, and records the overturns they hold", async () => {
    const { runner, fake, poll } = setup([DECISION]);
    vi.mocked(decisionIssues).mockReturnValue([862]);
    vi.mocked(fromOverturns).mockResolvedValue([OVERTURN]);

    await poll();

    expect(decisionIssues).toHaveBeenCalledWith([DECISION]);
    expect(fromOverturns).toHaveBeenCalledWith(runner, REPO, OWNER, [862]);
    expect(fake.record.mock.calls.map((c) => c[0].kind)).toEqual([
      "advisor.overturned",
    ]);
  });

  it("returns the message when a decided issue's comments cannot be read, and records nothing", async () => {
    const { fake, poll } = setup([DECISION]);
    vi.mocked(decisionIssues).mockReturnValue([862]);
    vi.mocked(fromOverturns).mockResolvedValue(
      "gh api issues/862/comments failed",
    );

    expect(await poll()).toEqual({
      ok: false,
      message: "gh api issues/862/comments failed",
    });
    expect(fake.record).not.toHaveBeenCalled();
  });
});
