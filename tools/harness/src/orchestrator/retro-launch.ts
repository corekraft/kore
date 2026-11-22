import type { BriefBackend } from "./judgment-briefs.js";
import {
  PROPOSALS_BEGIN,
  PROPOSALS_END,
  RETRO_CAP,
} from "./retro-proposals.js";

/** The tier a retro pane runs on: Sonnet at high effort, as spawned panes follow the Haiku-or-Sonnet rule. Reverse it if ideas from Sonnet retros are refuted at a clearly higher rate. */
export const RETRO_MODEL = "claude-sonnet-5-5";
export const RETRO_EFFORT = "high";

/** Why the launch overrides the reader definition's tier; `session spawn` writes it into the launch event. */
export const RETRO_REASON = "retro runs on Sonnet at high effort (ADR 0118)";

/** The role the retro pane takes: read-only, because a retro proposes and never edits. */
export const RETRO_ROLE = "reader";

/** The feature flag (ADR 0077) that lets the orchestrator start a retro; off unless an overlay turns it on. */
export const RETRO_FLAG = "automatic-retro";

/**
 * The retro pane's brief. An hc pane gives its proposals to session report on stdin; a
 * herdr pane prints them and its RESULT line, as it always has.
 */
export function retroBrief(
  reason: string,
  backend: BriefBackend = "herdr",
): string {
  const proposals = `End with your proposals as one JSON array, one object per idea with the string fields title, hypothesis, expectedOutcome, measurement, safetyPattern, metric, direction (up or down) and window (such as 14d), between a line ${PROPOSALS_BEGIN} and a line ${PROPOSALS_END}`;
  const finish =
    backend === "hc"
      ? ", then, as your last action, run `node skills/bin/harness.mjs session report --outcome done --summary - <<'EOF'` with your proposals on the lines after it, then a line that reads EOF."
      : ", then print RESULT: done.";
  return `Run the /retro skill: review the sessions since the last retrospective and end with ranked proposals. Propose only; change no file and record nothing. The trigger (${reason}) is already recorded. ${proposals}${finish} A tool files the first ${RETRO_CAP} as ideas and drops the rest, so rank them.`;
}

/** `retro due --json`, reduced to what the launch reads. */
export type RetroReport =
  { due: false } | { due: true; reason: "count" | "metric"; metric?: string };

export interface RetroPane {
  role: typeof RETRO_ROLE;
  name: string;
  model: typeof RETRO_MODEL;
  effort: typeof RETRO_EFFORT;
  reason: string;
  brief: string;
}

/** Every side effect a retro launch has; each is an existing harness tool, faked in specs. */
export interface RetroPorts {
  /** Whether the local overlay turns the flag on. */
  flagOn(): Promise<boolean>;
  /** `retro due --json`: read-only. */
  due(): Promise<RetroReport>;
  /** `retro record --reason`: the owning script writes the ledger event and moves the marker. */
  record(reason: string): Promise<{ recordedAt: string; appended: boolean }>;
  /** `session spawn --no-wait`. */
  spawn(pane: RetroPane): Promise<void>;
  /** The backend the retro pane's brief is written for: hc when the hc-sessions flag is on. */
  backend(): Promise<BriefBackend>;
}

export type RetroLaunchResult =
  | { status: "flag-off" | "not-due" | "already-triggered" }
  | { status: "launched"; reason: string; name: string };

/**
 * Starts a retro when one is due. The caller runs it only between pieces of
 * work, with no pane running. It records the trigger through `retro record`
 * before it launches, and launches only when that record was new, so a trigger
 * that already fired never starts a second pane. It never waits for the pane.
 */
export class RetroLaunch {
  constructor(private readonly ports: RetroPorts) {}

  async run(): Promise<RetroLaunchResult> {
    if (!(await this.ports.flagOn())) {
      return { status: "flag-off" };
    }
    const report = await this.ports.due();
    if (!report.due) {
      return { status: "not-due" };
    }
    const reason =
      report.reason === "metric" ? `metric:${report.metric}` : report.reason;
    const recorded = await this.ports.record(reason);
    if (!recorded.appended) {
      return { status: "already-triggered" };
    }
    const name = `retro-${recorded.recordedAt
      .slice(0, 16)
      .replace(/[-:]/g, "")
      .replace("T", "-")}`;
    await this.ports.spawn({
      role: RETRO_ROLE,
      name,
      model: RETRO_MODEL,
      effort: RETRO_EFFORT,
      reason: RETRO_REASON,
      brief: retroBrief(reason, await this.ports.backend()),
    });
    return { status: "launched", reason, name };
  }
}
