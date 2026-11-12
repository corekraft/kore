import type { Clock, FileSystem, Runner } from "../runtime/index.js";
import { acquire } from "./poll-lock.js";
import type { Ledger } from "./ledger.js";
import { isName, type EventInput, type Kind } from "./schema.js";

export type PollResult =
  | { ok: true; recorded: number; events: EventInput[] }
  | { ok: false; message: string };

type Known = Extract<Kind, `pane.${string}`>;

interface Seen {
  pane: string;
  agent: string;
  /** The pane's herdr status, mapped to the ledger kind that records it. */
  status: Known;
}

const PANE_KINDS: readonly Kind[] = [
  "pane.spawned",
  "pane.busy",
  "pane.waiting",
  "pane.closed",
];

/** Herdr statuses that mean the agent is working, or is idle or stopped for input. */
const STATUS_KIND: Record<string, Known | undefined> = {
  working: "pane.busy",
  idle: "pane.waiting",
  blocked: "pane.waiting",
  done: "pane.waiting",
};

function describe(code: number, stdout: string, stderr: string): string {
  const text = `${stderr}${stdout}`.trim();
  return text === "" ? `exit code ${code}` : `exit code ${code}: ${text}`;
}

function toSeen(entry: unknown): Seen | undefined {
  if (typeof entry !== "object" || entry === null) {
    return undefined;
  }
  const raw = entry as Record<string, unknown>;
  const pane = raw["pane_id"];
  const status = STATUS_KIND[String(raw["agent_status"])];
  // A name the ledger would refuse must not stop the poll: use the agent type, else "unknown".
  const agent = [raw["name"], raw["agent"]].find(isName) ?? "unknown";
  if (!isName(pane) || status === undefined) {
    return undefined;
  }
  return { pane, agent, status };
}

/** `present` holds every listed pane, even one whose status is not mapped, so it is never mistaken for closed. */
type Listed = { seen: Seen[]; present: Set<string> } | { message: string };

async function listAgents(runner: Runner): Promise<Listed> {
  const found = await runner.run("herdr", ["agent", "list"]);
  if (found.code !== 0) {
    return {
      message: `herdr agent list failed: ${describe(found.code, found.stdout, found.stderr)}. Is the herdr server running?`,
    };
  }
  let value: unknown;
  try {
    value = JSON.parse(found.stdout);
  } catch {
    return {
      message:
        "herdr agent list did not print JSON. Run `herdr agent list` by hand and check the herdr version.",
    };
  }
  const agents = (value as { result?: { agents?: unknown } } | null)?.result
    ?.agents;
  if (!Array.isArray(agents)) {
    return {
      message:
        "herdr agent list printed no agent list (.result.agents); the herdr version may have changed its output.",
    };
  }
  const present = new Set<string>();
  for (const entry of agents as unknown[]) {
    const pane = (entry as { pane_id?: unknown } | null)?.pane_id;
    if (typeof pane === "string") {
      present.add(pane);
    }
  }
  return { seen: agents.map(toSeen).filter((s) => s !== undefined), present };
}

/** The last recorded pane kind for each pane: the ledger itself is the state. */
async function lastRecorded(
  ledger: Ledger,
): Promise<Map<string, { kind: Kind; agent?: string }>> {
  const { events } = await ledger.list({ source: "herdr" });
  const last = new Map<string, { kind: Kind; agent?: string }>();
  for (const event of events) {
    if (event.pane !== undefined && PANE_KINDS.includes(event.kind)) {
      last.set(event.pane, {
        kind: event.kind,
        ...(event.agent === undefined ? {} : { agent: event.agent }),
      });
    }
  }
  return last;
}

/**
 * Reads herdr's agent state once and appends only what changed since the last
 * recorded state per pane. A pane first seen is `pane.spawned` followed by its
 * current status; a recorded pane no longer listed is `pane.closed`. Every
 * event's `occurredAt` is the moment the poll observed herdr, not the moment
 * the ledger wrote the line, so re-polling an unchanged state appends nothing.
 *
 * `pane.closed` means the pane no longer hosts an agent: the pane may still be
 * open as a shell, or gone, and a pane whose agent changed is closed then
 * spawned. The poll holds a lock file beside the ledger so concurrent pollers
 * cannot append the same transitions.
 */
export async function pollHerdr(deps: {
  ledger: Ledger;
  runner: Runner;
  clock: Clock;
  fs: FileSystem;
}): Promise<PollResult> {
  const held = await acquire(deps.fs, deps.clock, `${deps.ledger.path}.lock`);
  if (!held.ok) {
    return { ok: false, message: held.message };
  }
  try {
    return await poll(deps);
  } finally {
    await held.release();
  }
}

type Recorded = Map<string, { kind: Kind; agent?: string }>;

/** What changed between the last recorded pane states and what herdr lists now. */
function plan(
  listed: Extract<Listed, { seen: Seen[] }>,
  last: Recorded,
  observedAt: string,
): EventInput[] {
  const planned: EventInput[] = [];
  const event = (kind: Known, pane: string, agent: string) =>
    planned.push({
      source: "herdr",
      kind,
      occurredAt: observedAt,
      pane,
      agent,
    });
  for (const { pane, agent, status } of listed.seen) {
    const recorded = last.get(pane);
    const open = recorded !== undefined && recorded.kind !== "pane.closed";
    if (open && recorded.agent !== undefined && recorded.agent !== agent) {
      // A different agent now lives in a recorded pane: end the old one, start the new one.
      event("pane.closed", pane, recorded.agent);
    }
    const sameAgent = open && (recorded.agent ?? agent) === agent;
    if (!sameAgent) {
      event("pane.spawned", pane, agent);
    }
    if (!sameAgent || recorded.kind !== status) {
      event(status, pane, agent);
    }
  }
  for (const [pane, state] of last) {
    if (state.kind !== "pane.closed" && !listed.present.has(pane)) {
      event("pane.closed", pane, state.agent ?? "unknown");
    }
  }
  return planned;
}

async function poll(deps: {
  ledger: Ledger;
  runner: Runner;
  clock: Clock;
}): Promise<PollResult> {
  const observedAt = deps.clock.now().toISOString();
  const listed = await listAgents(deps.runner);
  if ("message" in listed) {
    return { ok: false, message: listed.message };
  }
  const planned = plan(listed, await lastRecorded(deps.ledger), observedAt);
  for (const input of planned) {
    const result = await deps.ledger.record(input);
    if (!result.ok) {
      return { ok: false, message: result.message };
    }
  }
  return { ok: true, recorded: planned.length, events: planned };
}
