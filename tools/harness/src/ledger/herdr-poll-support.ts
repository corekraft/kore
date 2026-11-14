// Fixtures and fakes for the herdr-poll unit spec: what `herdr agent list`
// prints, a recorded pane event, and one poll over fakes. Only that spec uses
// them, so they stay beside it (ADR 0098).
import {
  NOW,
  fakeClock,
  fakeFileSystem,
  fakeLedger,
  fakeRunner,
  ok,
  type FakeRunner,
} from "./ledger-support.js";
import type { LedgerEvent } from "./schema.js";
import { pollHerdr } from "./herdr-poll.js";

export interface Agent {
  pane_id: string;
  agent_status: string;
  name?: string;
  agent?: string;
}

/** What `herdr agent list` prints for these agents. */
export const listing = (agents: unknown[]) =>
  JSON.stringify({ result: { agents, type: "agent_list" } });

/** An agent named `writer` of type claude, in pane `w3:p74` unless the test says otherwise. */
export const writer = (status: string, pane = "w3:p74"): Agent => ({
  pane_id: pane,
  agent_status: status,
  name: "writer",
  agent: "claude",
});

/** A pane event the ledger already holds, for the last recorded state of each pane. */
export const paneEvent = (kind: string, pane: string, agent?: string) =>
  ({
    id: `herdr:${kind}:${pane}`,
    source: "herdr",
    kind,
    occurredAt: NOW,
    pane,
    ...(agent === undefined ? {} : { agent }),
    schema: 1,
    recordedAt: NOW,
  }) as LedgerEvent;

/** The herdr runner answers `agents`, and the ledger holds `events`. */
export function setupHerdr(agents: unknown[] = [], events: LedgerEvent[] = []) {
  const runner: FakeRunner = fakeRunner();
  runner.run.mockResolvedValue(ok(listing(agents)));
  return setupWith(runner, events);
}

/** The same poll, with the runner answering `stdout` as it is printed. */
export function setupRaw(stdout: string, code = 0, stderr = "") {
  const runner: FakeRunner = fakeRunner();
  runner.run.mockResolvedValue({ stdout, stderr, code });
  return setupWith(runner, []);
}

function setupWith(runner: FakeRunner, events: LedgerEvent[]) {
  const fake = fakeLedger();
  fake.list.mockResolvedValue({ events, skipped: 0 });
  fake.record.mockImplementation((input) =>
    Promise.resolve({
      ok: true,
      event: { ...input, schema: 1, recordedAt: NOW } as LedgerEvent,
    }),
  );
  const fs = fakeFileSystem();
  const clock = fakeClock();
  const poll = () => pollHerdr({ ledger: fake.ledger, runner, clock, fs });
  return { runner, fake, fs, clock, poll };
}

/** `isName`, stubbed: a non-empty string is a name the ledger accepts. */
export const isNameStub = (value: unknown) =>
  typeof value === "string" && value !== "";
