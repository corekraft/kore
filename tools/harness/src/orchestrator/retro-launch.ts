/** The model a retro pane runs on. A retro reads many sessions at once, so it is the one pane that runs on Opus by design. */
export const RETRO_MODEL = "claude-opus-5-5";

/** The role the retro pane takes: read-only, because a retro proposes and never edits. */
export const RETRO_ROLE = "reader";

/** The feature flag (ADR 0077) that lets the orchestrator start a retro; off unless an overlay turns it on. */
export const RETRO_FLAG = "automatic-retro";

/** `retro due --json`, reduced to what the launch reads. */
export type RetroReport =
  { due: false } | { due: true; reason: "count" | "metric"; metric?: string };

export interface RetroPane {
  role: typeof RETRO_ROLE;
  name: string;
  model: typeof RETRO_MODEL;
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
      brief: `Run the /retro skill: review the sessions since the last retrospective and end with ranked proposals. Propose only; change no file and record nothing. The trigger (${reason}) is already recorded.`,
    });
    return { status: "launched", reason, name };
  }
}
