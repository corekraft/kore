// A scripted host for `orchestrate run`: the tools it drives (`harness` and `gh`)
// are answered here and append the ledger events the real tools would, so a spec reads the
// run as a ledger. No network, no cluster, no process (ADR 0098, ADR 0104).

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CliDeps } from "../src/cli/index.js";
import type { Runner } from "../src/runtime/index.js";
import { nodeFileSystem } from "../src/runtime/index.js";

export interface Event {
  kind: string;
  name?: string;
  role?: string;
  pr?: number;
  label?: string;
}

export const PROPOSALS = [
  {
    title: "Cut send-backs",
    hypothesis: "h1",
    expectedOutcome: "e1",
    measurement: "m1",
    safetyPattern: "no-behaviour-change",
    metric: "friction.total",
    direction: "down",
    window: "14d",
  },
  {
    title: "Shorten reviews",
    hypothesis: "h2",
    expectedOutcome: "e2",
    measurement: "m2",
    safetyPattern: "no-behaviour-change",
    metric: "friction.total",
    direction: "down",
    window: "14d",
  },
];

export interface Host {
  events: Event[];
  /** `idea new` calls, in order, by slug. */
  ideaNew: string[];
  /** Slugs the idea domain holds, so a repeated slug is `created: false`. */
  ideas: Map<string, string>;
  /** Precheck reports in order; the last one repeats. */
  prechecks: unknown[];
  /** Whether `retro record` reports a new trigger every time (a lost marker). */
  retroAlwaysNew: boolean;
  runner: Runner;
  /** Counters the scripted tools keep between calls. */
  state: { precheckCalls: number; retroRecords: number; merged: boolean };
}

const PR = 50;
const RECORDED_AT = "2026-11-15T10:20:00.000Z";

const out = (value: unknown) => ({
  stdout: JSON.stringify(value),
  stderr: "",
  code: 0,
});
const NONE = { stdout: "", stderr: "", code: 0 };
const flag = (args: string[], name: string) =>
  args[args.indexOf(name) + 1] ?? "";

type Answer = { stdout: string; stderr: string; code: number };
type Handler = (h: Host, args: string[]) => Answer;

const record = (h: Host, event: Event): Answer => {
  h.events.push(event);
  return NONE;
};

function spawn(h: Host, args: string[]): Answer {
  const role = flag(args, "--role");
  if (role === "judge") {
    h.state.merged = true;
  }
  return record(h, {
    kind: "session.launch",
    role,
    name: flag(args, "--name"),
  });
}

function retroRecord(h: Host): Answer {
  h.state.retroRecords += 1;
  const appended = h.retroAlwaysNew || h.state.retroRecords === 1;
  if (appended) {
    h.events.push({ kind: "retro.triggered" });
  }
  return out({ recordedAt: RECORDED_AT, appended });
}

function ideaNew(h: Host, args: string[]): Answer {
  const slug = flag(args, "--slug");
  h.ideaNew.push(slug);
  const created = !h.ideas.has(slug);
  if (created) {
    h.ideas.set(slug, String(h.ideas.size + 100));
  }
  return out({ created, number: h.ideas.get(slug) });
}

function ledgerList(h: Host, args: string[]): Answer {
  const kind = flag(args, "--kind");
  return out({ events: h.events.filter((e) => e.kind === kind) });
}

function precheck(h: Host): Answer {
  const at = Math.min(h.state.precheckCalls, h.prechecks.length - 1);
  h.state.precheckCalls += 1;
  h.events.push({ kind: "precheck", pr: PR });
  return out(h.prechecks[at]);
}

/** The scripted `harness <domain> <verb>` tools, by their words. */
const HARNESS: Record<string, Handler> = {
  "queue next": () =>
    out({ queue: [{ kind: "idea", idea: "0042", issue: 42, title: "t" }] }),
  "queue send-backs": () => out({ count: 1, model: "haiku", escalate: false }),
  "session spawn": spawn,
  "session wait": () => out({ outcome: "done", summary: PANE }),
  "session close": () => NONE,
  "review run": (h, a) => record(h, { kind: "review.run", pr: Number(a[2]) }),
  "judge send-back": (h, a) =>
    record(h, { kind: "judge.send-back", pr: Number(a[2]) }),
  "outcome record": (h) => record(h, { kind: "outcome.recorded" }),
  "retro due": () => out({ due: true, reason: "count" }),
  "retro record": retroRecord,
  "idea new": ideaNew,
  "ledger record": (h, a) =>
    record(h, { kind: flag(a, "--kind"), label: flag(a, "--label") }),
  "ledger list": ledgerList,
};

const PANE = `done\nPROPOSALS-JSON\n${JSON.stringify(PROPOSALS)}\nEND-PROPOSALS-JSON\nRESULT: done\n`;

function answer(h: Host, command: string, args: string[]): Answer {
  if (command === "gh") {
    const mergedAt = h.state.merged ? "2026-11-15T10:10:00Z" : null;
    return out([{ number: PR, mergedAt }]);
  }
  const words = args.slice(1);
  if (words[0] === "judge" && words[1] === "precheck") {
    return precheck(h);
  }
  const handler = HARNESS[`${words[0]} ${words[1]}`];
  if (handler === undefined) {
    throw new Error(`unscripted harness call: ${words.join(" ")}`);
  }
  return handler(h, words);
}

export function host(prechecks: unknown[]): Host {
  const h: Host = {
    events: [],
    ideaNew: [],
    ideas: new Map(),
    prechecks,
    retroAlwaysNew: false,
    state: { precheckCalls: 0, retroRecords: 0, merged: false },
    runner: { run: () => Promise.reject(new Error("unset")) },
  };
  h.runner = {
    run: (command, args) => Promise.resolve(answer(h, command, [...args])),
  };
  return h;
}

/** A repo root whose local overlay turns `automatic-retro` on or off. */
export function repo(retro: boolean): string {
  const root = mkdtempSync(join(tmpdir(), "orchestrate-run-"));
  const dir = join(root, "infra/environments/local");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "environment.yaml"),
    JSON.stringify({ features: { "automatic-retro": retro } }),
  );
  return root;
}

export function deps(
  h: Host,
  root: string,
): { deps: CliDeps; stderr: string[]; stdout: string[] } {
  const stderr: string[] = [];
  const stdout: string[] = [];
  return {
    stderr,
    stdout,
    deps: {
      runner: h.runner,
      fs: nodeFileSystem,
      clock: { now: () => new Date(RECORDED_AT) },
      root: () => Promise.resolve(root),
      stdout: (t: string) => stdout.push(t),
      stderr: (t: string) => stderr.push(t),
    } as unknown as CliDeps,
  };
}
