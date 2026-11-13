import type { Runner } from "../runtime/index.js";
import { MemoryFileSystem } from "../runtime/memory-filesystem-support.js";
import { Ledger } from "./ledger.js";
import { pollSignals } from "./github-signals.js";

const PATH = "/repo/.kore/state/ledger.jsonl";

/** A JSON value gh prints, or a function that answers by the call's arguments. */
type Answer = unknown;

/** Answers each `gh` call by a fragment of its arguments; anything else is an empty list. */
export function setup(answers: Record<string, Answer>, code = 0) {
  const fs = new MemoryFileSystem();
  const clock = {
    now: () => new Date("2026-02-01T00:00:00Z"),
    sleep: () => Promise.resolve(),
  };
  let n = 0;
  const ledger = new Ledger(fs, clock, { next: () => `id-${++n}` }, PATH);
  const calls: string[] = [];
  const runner: Runner = {
    run(_command, args) {
      const text = args.join(" ");
      calls.push(text);
      const key = Object.keys(answers).find((k) => text.includes(k));
      const answer = key === undefined ? [] : answers[key];
      if (typeof answer === "function") {
        const got = (answer as (t: string) => object)(text) as {
          stdout?: string;
          stderr?: string;
          code?: number;
        };
        return Promise.resolve({ stdout: "", stderr: "", code: 0, ...got });
      }
      return Promise.resolve({
        stdout: JSON.stringify(answer),
        stderr: code === 0 ? "" : "boom",
        code,
      });
    },
  } as Runner;
  const poll = (since?: string) =>
    pollSignals({
      ledger,
      runner,
      clock,
      fs,
      repo: "corekraft/kore",
      owner: "junners",
      ...(since === undefined ? {} : { since }),
    });
  const stored = async () => (await ledger.list({})).events;
  return { poll, stored, calls, ledger };
}

export const run = (
  databaseId: number,
  conclusion: string,
  updatedAt: string,
  attempt = 1,
) => ({
  databaseId,
  conclusion,
  updatedAt,
  attempt,
  displayTitle: "secret title",
});
