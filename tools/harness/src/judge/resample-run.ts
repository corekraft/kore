import {
  RESAMPLE_EFFORT,
  RESAMPLE_MODEL,
  RESAMPLE_REASON,
  type ResampleCandidate,
} from "./resample.js";
import { readVerdict } from "./review-verdict-read.js";

/** The role a re-review pane takes: read-only, so it reports and a tool records. */
const ROLE = "reader";

/** What `session spawn` is asked for: a reader on the override tier, with its reason. */
export interface ResampleLaunch {
  name: string;
  role: typeof ROLE;
  brief: string;
  model: string;
  effort: string;
  reason: string;
}

/** Every side effect a re-review has: the pane through `session` tools and herdr, the ledger. */
export interface ResamplePorts {
  /** `session spawn --no-wait` with the launch's tier and reason. */
  spawn(launch: ResampleLaunch): Promise<void>;
  /** `session wait`: the reader's outcome. */
  wait(name: string): Promise<{ outcome: "done" | "blocked" }>;
  /** The text the reader answered with, read by its session name. */
  read(name: string): Promise<string>;
  /** `session close`. */
  close(name: string): Promise<void>;
  /** Appends a review.run event for the PR; with findings only for a verdict that was read. */
  record(pr: number, label: string, findings?: number): Promise<void>;
}

export interface ResampleResult {
  /** Re-reviews that read a verdict, with the findings it gave (0 when it passed again). */
  reviewed: { pr: number; head: string; findings: number }[];
  /** Re-reviews that ended blocked or with no verdict; recorded, never counted as a pass. */
  failed: { pr: number; head: string; reason: string }[];
}

type Outcome = { findings: number } | { reason: string };

/**
 * The re-review brief, one line, so no line of it is only a verdict marker, which the
 * reader would take for its own answer.
 */
export function resamplerBrief(
  pr: number,
  head: string,
  backend: "herdr" | "hc" = "herdr",
): string {
  const finish =
    backend === "hc"
      ? "Then, as your last action, run `node skills/bin/harness.mjs session report --outcome done --summary - <<'EOF'`, with your verdict lines on the lines after it, then a line that reads EOF; or use --outcome blocked when you cannot review."
      : "Then end with the word RESULT, a colon, then done or blocked.";
  return (
    `Re-review PR #${pr} at head ${head} against AGENTS.md, reading the change with \`gh pr diff ${pr}\` and the files at that head. ` +
    "Do not post anything. This is an independent check of a review that passed: report every rule break you find. " +
    'End your final report with the verdict on lines of their own: either a line that is only "VERDICT: none" when you found no violations, ' +
    'or a line that is only "VERDICT: findings", then each finding on its own line as `file:line | rule | what is wrong | smallest fix`, ' +
    'then a line that is only "END VERDICT". ' +
    finish
  );
}

/**
 * Re-reviews each sampled head with a Sonnet reader, one pane at a time. A pane that
 * ends blocked or with no verdict is recorded as a failure and the run carries on, so one
 * bad pane does not stop the sample. Each pane is closed whatever happens to it.
 */
export class ResampleRun {
  constructor(
    private readonly ports: ResamplePorts,
    private readonly backend: "herdr" | "hc" = "herdr",
  ) {}

  async run(sample: readonly ResampleCandidate[]): Promise<ResampleResult> {
    const result: ResampleResult = { reviewed: [], failed: [] };
    for (const { pr, head } of sample) {
      const outcome = await this.one(pr, head);
      if ("findings" in outcome) {
        result.reviewed.push({ pr, head, findings: outcome.findings });
      } else {
        result.failed.push({ pr, head, reason: outcome.reason });
      }
    }
    return result;
  }

  private async one(pr: number, head: string): Promise<Outcome> {
    const name = `resample-pr${pr}-${head}`;
    await this.ports.spawn({
      name,
      role: ROLE,
      brief: resamplerBrief(pr, head, this.backend),
      model: RESAMPLE_MODEL,
      effort: RESAMPLE_EFFORT,
      reason: RESAMPLE_REASON,
    });
    let text: string;
    try {
      const waited = await this.ports.wait(name);
      if (waited.outcome === "blocked") {
        await this.ports.record(pr, `resample-failed:${head}`);
        return { reason: "blocked" };
      }
      text = await this.ports.read(name);
    } finally {
      await this.ports.close(name);
    }
    const findings = readVerdict(text);
    if (findings === undefined) {
      await this.ports.record(pr, `resample-failed:${head}`);
      return { reason: "no verdict" };
    }
    await this.ports.record(pr, `resample:${head}`, findings.length);
    return { findings: findings.length };
  }
}
