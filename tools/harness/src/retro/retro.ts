import { join } from "node:path";
import { lastRetrospective, markerInstant } from "../hook/index.js";
import type { Ledger } from "../ledger/index.js";
import type { Clock, FileSystem } from "../runtime/index.js";
import { decideRetro, type Due, type DueInput } from "./due.js";
import { withMarker } from "./marker.js";

/** The plan whose marker section `retro record` keeps; the session brief reads it with the other plans. */
export const PLAN_WITH_MARKER = "infra/plans/3-agent-harness.md";

/** A reason that is not count, manual or metric plus a name, or a marker that cannot be kept. */
export class RetroError extends Error {}

const REASON = /^(count|manual|metric:[A-Za-z][A-Za-z0-9]*)$/;

export interface RetroPorts {
  ledger: Pick<Ledger, "list" | "record">;
  fs: Pick<FileSystem, "readFile" | "writeFile">;
  clock: Clock;
  /** Absolute repository root. */
  root: string;
  readPlans(): Promise<Record<string, string>>;
}

export type DueReport = Due & { lastRetrospective: string | null };

export interface Recorded {
  reason: string;
  recordedAt: string;
  /** False when the window already held this reason, so the ledger got nothing new. */
  appended: boolean;
}

/** Decides whether a retro is due and records one. It never starts a retro. */
export class Retro {
  constructor(private readonly ports: RetroPorts) {}

  private async window() {
    const marker = lastRetrospective(await this.ports.readPlans());
    return {
      marker,
      start: marker === null ? 0 : markerInstant(marker),
    };
  }

  private async triggers() {
    const { events } = await this.ports.ledger.list({
      kind: "retro-triggered",
    });
    return events.flatMap((e) =>
      e.label === undefined
        ? []
        : [{ at: Date.parse(e.occurredAt), reason: e.label }],
    );
  }

  /** Read-only: nothing is written however the answer comes out. */
  async due(metrics: DueInput["metrics"]): Promise<DueReport> {
    const { marker, start } = await this.window();
    const { events } = await this.ports.ledger.list({ kind: "outcome" });
    const closed = events.flatMap((e) =>
      e.idea === undefined
        ? []
        : [{ idea: e.idea, at: Date.parse(e.occurredAt) }],
    );
    const due = decideRetro({
      windowStart: start,
      closed,
      metrics,
      triggers: await this.triggers(),
    });
    return { ...due, lastRetrospective: marker };
  }

  /**
   * Appends the retro-triggered event once per reason and window, then moves
   * the marker to the event's own second, so the window opens exactly there.
   */
  async record(reason: string): Promise<Recorded> {
    if (!REASON.test(reason)) {
      throw new RetroError(
        `"${reason}" is not a retro reason; use count, manual or metric:<name>, for example \`harness retro record --reason count\`.`,
      );
    }
    const planPath = join(this.ports.root, PLAN_WITH_MARKER);
    let plan: string;
    try {
      plan = await this.ports.fs.readFile(planPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      throw new RetroError(
        `${PLAN_WITH_MARKER} is missing, so the marker cannot move; restore it, then rerun.`,
      );
    }
    const stamp = `${this.ports.clock.now().toISOString().slice(0, 19)}Z`;
    const { start } = await this.window();
    const already = (await this.triggers()).some(
      (t) => t.reason === reason && t.at > start,
    );
    if (!already) {
      const written = await this.ports.ledger.record({
        source: "claude",
        kind: "retro-triggered",
        occurredAt: `${stamp.slice(0, 19)}.000Z`,
        label: reason,
      });
      if (!written.ok) {
        throw new RetroError(
          `The retro-triggered event was rejected: ${written.message} Fix the ledger, then rerun \`harness retro record --reason ${reason}\`.`,
        );
      }
    }
    await this.ports.fs.writeFile(planPath, withMarker(plan, stamp));
    return { reason, recordedAt: stamp, appended: !already };
  }
}
