import { MemoryFileSystem } from "../../src/testing/index.js";
import type { RunOptions, RunResult, Runner } from "../../src/runtime/index.js";
import { pollGithub } from "../../src/ledger/index.js";
import { Ledger } from "../../src/ledger/index.js";

export const PATH = "/repo/.kore/state/ledger.jsonl";
export const REPO = "corekraft/kore";

export interface Gh {
  issues: unknown[];
  prs: unknown[];
  /** What `gh api repos/R/issues/events?page=N` prints for page N: one array of events per page, newest first. */
  events: unknown[];
  /** The exit code and stderr every canned `gh` call returns, except `gh api rate_limit`. */
  code: number;
  stderr: string;
  /** What `gh api rate_limit` prints. */
  rateLimit: string;
  /** Runs before each `gh` call answers. */
  onCall: () => void;
}

export interface Call {
  command: string;
  args: readonly string[];
  options: RunOptions | undefined;
}

/** `count` label events on one day, ids from `first`: a full page as the events API serves it. */
export const fullPage = (first: number, day: string, count = 100) =>
  Array.from({ length: count }, (_, i) =>
    labelled(first + i, first + i, `${day}T10:00:00Z`, "bug"),
  );

/** Answers `gh` the way GitHub does: lists, then the events API one page per call. */
class GhRunner implements Runner {
  readonly calls: Call[] = [];
  constructor(private readonly gh: Gh) {}

  run(
    command: string,
    args: readonly string[],
    options?: RunOptions,
  ): Promise<RunResult> {
    this.calls.push({ command, args, options });
    this.gh.onCall();
    const text = args.join(" ");
    const ok = (value: unknown) => ({
      stdout: typeof value === "string" ? value : JSON.stringify(value),
      stderr: "",
      code: 0,
    });
    if (text.includes("rate_limit")) {
      return Promise.resolve(ok(this.gh.rateLimit));
    }
    if (this.gh.code !== 0) {
      return Promise.resolve({
        stdout: "",
        stderr: this.gh.stderr,
        code: this.gh.code,
      });
    }
    if (args[0] === "issue") {
      return Promise.resolve(ok(this.gh.issues));
    }
    if (args[0] === "pr") {
      return Promise.resolve(ok(this.gh.prs));
    }
    const page = Number(/[?&]page=(\d+)/.exec(text)?.[1] ?? "1");
    return Promise.resolve(ok(this.gh.events[page - 1] ?? []));
  }
}

/** Canned `gh` JSON. Titles and bodies are included on purpose: they must never be stored. */
export const issue = (
  number: number,
  createdAt: string,
  closedAt?: string,
) => ({
  number,
  createdAt,
  closedAt: closedAt ?? null,
  title: "secret title",
  body: "secret body",
});
export const pr = (
  number: number,
  createdAt: string,
  mergedAt?: string,
  closes: number[] = [],
) => ({
  number,
  createdAt,
  mergedAt: mergedAt ?? null,
  closingIssuesReferences: closes.map((n) => ({ number: n })),
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
  let skew = 0;
  const clock = {
    now: () => new Date(Date.parse(start) + skew + 1000 * tick++),
    sleep: () => Promise.resolve(),
  };
  let n = 0;
  const ledger = new Ledger(fs, clock, { next: () => `id-${++n}` }, PATH);
  const gh: Gh = {
    issues: [],
    prs: [],
    events: [],
    code: 0,
    stderr: "",
    rateLimit: "{}",
    onCall: () => undefined,
  };
  const runner = new GhRunner(gh);
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
  /** Moves the clock forward, as a slow `gh` call would. */
  const advance = (ms: number) => {
    skew += ms;
  };
  const calls = () => runner.calls.map((c) => c.args.join(" "));
  return { fs, ledger, runner, gh, poll, stored, summary, advance, calls };
}
