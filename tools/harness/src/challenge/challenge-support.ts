// Fakes and fixtures shared by the challenge domain's unit specs. A support file
// is not a unit, so it needs no spec of its own (ADR 0098).
import { vi } from "vitest";
import type { IdeaRecord, IdeaRepository } from "../idea/index.js";
import type { Runner, RunResult } from "../runtime/index.js";
import type { Context } from "./challenge.js";
import captured from "./fixtures/gh-issue-comments.json" with { type: "json" };

/** A captured `gh issue view --json comments` payload, as gh printed it. */
export const CAPTURED_COMMENTS: string = JSON.stringify(captured);

export const RECORD = {
  number: "0001",
  slug: "cache-the-probe-results",
  path: "docs/ideas/0001-cache-the-probe-results.md",
  issue: "300",
} as IdeaRecord;

export const ISSUE = "https://github.com/corekraft/kore/issues/300";

export const ok = (stdout = ""): RunResult => ({ stdout, stderr: "", code: 0 });

export const failed = (stderr: string): RunResult => ({
  stdout: "",
  stderr,
  code: 1,
});

/** A typed runner whose reply depends on the arguments of each call. */
export function fakeRunner(reply: (args: readonly string[]) => RunResult) {
  const run = vi.fn<Runner["run"]>(async (_command, args) => reply(args));
  const runner: Runner = { run };
  return { runner, run };
}

/** The context a challenge runs in: a repository that returns one record, and a root. */
export function fakeContext(
  runner: Runner,
  record: IdeaRecord = RECORD,
): Context {
  const repo = {
    get: () => Promise.resolve(record),
  } as unknown as IdeaRepository;
  return { repo, runner, root: "/repo" };
}
