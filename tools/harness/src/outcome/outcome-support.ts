// Fakes and fixtures shared by the outcome domain's unit specs. A support file is
// not a unit, so it needs no spec of its own (ADR 0098).
import { vi, type Mock } from "vitest";
import type { IdeaRecord, IdeaRepository } from "../idea/index.js";
import type { Clock, RunResult, Runner } from "../runtime/index.js";
import type { Outcome } from "./model.js";

/** A runner whose `run` is a mock the spec reads its calls from. */
export interface FakeRunner {
  run: Mock<Runner["run"]>;
}

/**
 * A typed runner. `reply` answers each call with the fields it names; every
 * other field is a success with no output.
 */
export function fakeRunner(
  reply: (
    command: string,
    args: readonly string[],
  ) => Partial<RunResult> = () => ({}),
): FakeRunner {
  return {
    run: vi.fn<Runner["run"]>((command, args) =>
      Promise.resolve({
        stdout: "",
        stderr: "",
        code: 0,
        ...reply(command, args),
      }),
    ),
  };
}

/** The four repository methods the outcome units call, as the mocks a spec reads. */
export interface RepositoryMocks {
  get: Mock<IdeaRepository["get"]>;
  create: Mock<IdeaRepository["create"]>;
  source: Mock<IdeaRepository["source"]>;
  recordOutcome: Mock<IdeaRepository["recordOutcome"]>;
}

/**
 * A repository whose four methods are `mocks`. The one cast stands in for the
 * rest of the class, whose private fields these units never read.
 */
export function fakeRepository(): {
  repo: IdeaRepository;
  mocks: RepositoryMocks;
} {
  const mocks: RepositoryMocks = {
    get: vi.fn<IdeaRepository["get"]>(),
    create: vi.fn<IdeaRepository["create"]>(),
    source: vi.fn<IdeaRepository["source"]>(),
    recordOutcome: vi.fn<IdeaRepository["recordOutcome"]>(),
  };
  return { repo: mocks as unknown as IdeaRepository, mocks };
}

/** A clock that always reads `now`; it never sleeps. */
export function fakeClock(now = new Date("2026-11-14T08:30:00Z")): Clock {
  return {
    now: vi.fn<Clock["now"]>(() => now),
    sleep: vi.fn<Clock["sleep"]>(() => Promise.resolve()),
  };
}

/** An idea record with idea 0001 linked to issue 300. */
export function ideaRecord(overrides: Partial<IdeaRecord> = {}): IdeaRecord {
  return {
    number: "0001",
    slug: "cache-the-probe-results",
    path: "docs/ideas/0001-cache-the-probe-results.md",
    title: "Cache the probe results",
    summary: "Probes repeat work the last run already did.",
    hypothesis: "Caching the probe results cuts up time.",
    expectedOutcome: "Up time falls below 30s.",
    measurement: "kore local up p50 before and after.",
    safetyPattern: "no-behaviour-change",
    date: "2026-11-01",
    issue: "https://github.com/corekraft/kore/issues/300",
    ...overrides,
  };
}

/** A confirmed comparison outcome, as a caller passes it to recordOutcome. */
export function outcome(overrides: Partial<Outcome> = {}): Outcome {
  return {
    kind: "experiment",
    source: "comparison",
    result: "confirmed",
    evidence: "kore local up p50 41s before, 29s after",
    summary: "Up time fell from 41s to 29s.",
    ...overrides,
  };
}
