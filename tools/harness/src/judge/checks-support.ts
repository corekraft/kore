// Fixtures and a fake runner shared by the judge checks spec. A support file is
// not a unit, so it needs no spec of its own (ADR 0098).
import { vi } from "vitest";
import type { Runner } from "../runtime/index.js";
import type { PrView } from "./checks.js";

export const RUN_URL =
  "https://github.com/corekraft/kore/actions/runs/777/job/1";
export const SHA = "abc1234def5678abc1234def5678abc1234def56";
export const REPO = "corekraft/kore";
export const ROOT = "/repo";

/** A PR whose CI and scan jobs both succeeded, and whose head was committed on 1 January. */
export function viewOf(overrides: Partial<PrView> = {}): PrView {
  return {
    baseSha: "1111111aaaaaaaa",
    body: "",
    comments: [],
    headCommittedAt: "2026-01-01T00:00:00Z",
    headSha: SHA,
    rollup: [
      {
        name: "check",
        status: "COMPLETED",
        conclusion: "SUCCESS",
        url: RUN_URL,
      },
      {
        name: "scan",
        status: "COMPLETED",
        conclusion: "SUCCESS",
        url: RUN_URL,
      },
    ],
    ...overrides,
  };
}

/** A runner that answers every call with the given output and exit code. */
export function runnerOf(stdout = "", code = 0, stderr = "") {
  return { run: vi.fn().mockResolvedValue({ stdout, stderr, code }) };
}

export type FakeRunner = ReturnType<typeof runnerOf>;

/** The `jobs` output of `gh run view`, with the CI job's steps and their conclusions. */
export function stepsJson(conclusions: Record<string, string>): string {
  return JSON.stringify({
    jobs: [
      {
        name: "check",
        steps: Object.entries(conclusions).map(([name, conclusion]) => ({
          name,
          conclusion,
        })),
      },
    ],
  });
}

export const asRunner = (runner: FakeRunner) => runner as unknown as Runner;
