// A scripted host for `orchestrate run`: the tools it drives (`harness`, `gh`, `herdr`)
// are answered here and append the ledger events the real tools would, so a spec reads the
// run as a ledger. No network, no cluster, no process (ADR 0098, ADR 0104).

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommandContext, Runner } from "../src/runtime/index.js";
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
}

const PR = 50;
const RECORDED_AT = "2026-11-15T10:20:00.000Z";

export function host(prechecks: unknown[]): Host {
  const h: Host = {
    events: [],
    ideaNew: [],
    ideas: new Map(),
    prechecks,
    retroAlwaysNew: false,
    runner: { run: () => Promise.reject(new Error("unset")) },
  };
  let precheckCalls = 0;
  let retroRecords = 0;
  let merged = false;
  const out = (value: unknown) => ({
    stdout: JSON.stringify(value),
    stderr: "",
    code: 0,
  });
  const none = { stdout: "", stderr: "", code: 0 };
  const flag = (args: string[], name: string) =>
    args[args.indexOf(name) + 1] ?? "";

  const harness = (args: string[]) => {
    const [domain, verb] = args;
    if (domain === "queue" && verb === "next") {
      return out({
        queue: [{ kind: "idea", idea: "0042", issue: 42, title: "t" }],
      });
    }
    if (domain === "queue" && verb === "send-backs") {
      return out({ count: 1, model: "haiku", escalate: false });
    }
    if (domain === "session" && verb === "spawn") {
      const role = flag(args, "--role");
      const name = flag(args, "--name");
      h.events.push({ kind: "session.launch", role, name });
      if (role === "judge") {
        merged = true;
      }
      return none;
    }
    if (domain === "session" && verb === "wait") {
      return out({ outcome: "done", paneId: `pane-${args[2]}` });
    }
    if (domain === "session" && verb === "close") {
      return none;
    }
    if (domain === "review" && verb === "run") {
      h.events.push({ kind: "review.run", pr: Number(args[2]) });
      return none;
    }
    if (domain === "judge" && verb === "send-back") {
      h.events.push({ kind: "judge.send-back", pr: Number(args[2]) });
      return none;
    }
    if (domain === "outcome" && verb === "record") {
      h.events.push({ kind: "outcome.recorded" });
      return none;
    }
    if (domain === "retro" && verb === "due") {
      return out({ due: true, reason: "count" });
    }
    if (domain === "retro" && verb === "record") {
      retroRecords += 1;
      const appended = h.retroAlwaysNew || retroRecords === 1;
      if (appended) {
        h.events.push({ kind: "retro.triggered" });
      }
      return out({ recordedAt: RECORDED_AT, appended });
    }
    if (domain === "idea" && verb === "new") {
      const slug = flag(args, "--slug");
      h.ideaNew.push(slug);
      const created = !h.ideas.has(slug);
      if (created) {
        h.ideas.set(slug, String(h.ideas.size + 100));
      }
      return out({ created, number: h.ideas.get(slug) });
    }
    if (domain === "ledger" && verb === "record") {
      h.events.push({
        kind: flag(args, "--kind"),
        label: flag(args, "--label"),
      });
      return none;
    }
    if (domain === "ledger" && verb === "list") {
      return out({
        events: h.events.filter((e) => e.kind === flag(args, "--kind")),
      });
    }
    throw new Error(`unscripted harness call: ${args.join(" ")}`);
  };

  h.runner = {
    run: (command, args) => {
      if (command === "gh") {
        return Promise.resolve(
          out([
            { number: PR, mergedAt: merged ? "2026-11-15T10:10:00Z" : null },
          ]),
        );
      }
      if (command === "herdr") {
        return Promise.resolve({
          stdout: `done\nPROPOSALS-JSON\n${JSON.stringify(PROPOSALS)}\nEND-PROPOSALS-JSON\nRESULT: done\n`,
          stderr: "",
          code: 0,
        });
      }
      if (args.includes("precheck")) {
        const at = Math.min(precheckCalls, h.prechecks.length - 1);
        precheckCalls += 1;
        h.events.push({ kind: "precheck", pr: PR });
        return Promise.resolve(out(h.prechecks[at]));
      }
      return Promise.resolve(harness(args.slice(1)));
    },
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

export function context(
  h: Host,
  root: string,
  options: Record<string, string | boolean>,
): { context: CommandContext; stderr: string[]; stdout: string[] } {
  const stderr: string[] = [];
  const stdout: string[] = [];
  return {
    stderr,
    stdout,
    context: {
      json: false,
      options,
      deps: {
        runner: h.runner,
        fs: nodeFileSystem,
        clock: { now: () => new Date(RECORDED_AT) },
        root: () => Promise.resolve(root),
        stdout: (t: string) => stdout.push(t),
        stderr: (t: string) => stderr.push(t),
      } as unknown as CommandContext["deps"],
    },
  };
}
