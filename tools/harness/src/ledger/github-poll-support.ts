import { MemoryFileSystem } from "../runtime/memory-filesystem-support.js";
import { FakeRunner } from "../runtime/runner-support.js";
import { pollGithub } from "./github-poll.js";
import { Ledger } from "./ledger.js";

export const PATH = "/repo/.kore/state/ledger.jsonl";
export const REPO = "corekraft/kore";

export interface Gh {
  issues: unknown[];
  prs: unknown[];
  events: unknown[];
  /** The exit code every canned `gh` call returns. */
  code: number;
}

/** Canned `gh` JSON. Titles and bodies are included on purpose: they must never be stored. */
export const issue = (number: number, createdAt: string) => ({
  number,
  createdAt,
  title: "secret title",
  body: "secret body",
});
export const pr = (number: number, createdAt: string, mergedAt?: string) => ({
  number,
  createdAt,
  mergedAt: mergedAt ?? null,
  title: "secret title",
  body: "secret body",
});
export const labelled = (
  id: number,
  number: number,
  at: string,
  name: string,
) => ({
  id,
  event: "labeled",
  created_at: at,
  label: { name },
  issue: { number },
});

export function setup(start = "2026-02-01T00:00:00.000Z") {
  const fs = new MemoryFileSystem();
  let tick = 0;
  const clock = {
    now: () => new Date(Date.parse(start) + 1000 * tick++),
  };
  let n = 0;
  const ledger = new Ledger(fs, clock, { next: () => `id-${++n}` }, PATH);
  const gh: Gh = { issues: [], prs: [], events: [], code: 0 };
  const runner = new FakeRunner([
    {
      match: (c, a) => c === "gh" && a[0] === "issue",
      result: {
        get stdout() {
          return JSON.stringify(gh.issues);
        },
        get code() {
          return gh.code;
        },
      },
    },
    {
      match: (c, a) => c === "gh" && a[0] === "pr",
      result: {
        get stdout() {
          return JSON.stringify(gh.prs);
        },
        get code() {
          return gh.code;
        },
      },
    },
    {
      match: (c, a) => c === "gh" && a[0] === "api",
      result: {
        get stdout() {
          return JSON.stringify(gh.events);
        },
        get code() {
          return gh.code;
        },
      },
    },
  ]);
  const poll = (since?: string) =>
    pollGithub({
      ledger,
      runner,
      clock,
      fs,
      repo: REPO,
      ...(since === undefined ? {} : { since }),
    });
  const stored = async () => (await ledger.list({})).events;
  const summary = async () =>
    (await stored()).map((e) => `${e.kind}:${e.number}`);
  return { fs, ledger, runner, gh, poll, stored, summary };
}
