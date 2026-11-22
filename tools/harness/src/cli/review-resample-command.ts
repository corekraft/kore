import {
  drawSample,
  JudgeError,
  RESAMPLE_SIZE,
  ResampleRun,
  type ResampleCandidate,
  type ResamplePorts,
  type ResampleResult,
  resampleCandidates,
} from "../judge/index.js";
import type { LedgerEvent } from "../ledger/index.js";
import type { CommandContext } from "../runtime/index.js";
import { briefBackend } from "../session/index.js";
import { failed } from "./judge-shared.js";
import type { Backend } from "./review-settled.js";

const USAGE = "Run `harness review resample [--size n] [--json]`.";

/** What a re-review reads: the shared ledger's events, and the ports its panes run through. */
export interface ResampleIo {
  events: LedgerEvent[];
  ports: ResamplePorts;
}

/** `--size`: a whole number of 1 or more, or the placeholder sample size when left out. */
function sizeOf(value: string | boolean | undefined): number {
  if (value === undefined) {
    return RESAMPLE_SIZE;
  }
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new JudgeError(
      `--size must be a whole number of 1 or more. ${USAGE}`,
    );
  }
  return Number(value);
}

/** The result as the command prints it: the sample drawn, and what each re-review read or failed on. */
interface ResampleOutput {
  sample: ResampleCandidate[];
  reviewed: ResampleResult["reviewed"];
  failed: ResampleResult["failed"];
}

const noun = (count: number, word: string) =>
  `${word}${count === 1 ? "" : "s"}`;

function summaryOf({
  sample,
  reviewed,
  failed: failures,
}: ResampleOutput): string {
  if (sample.length === 0) {
    return "No passed review of a merged PR is waiting for a re-review, so no reader was started\n";
  }
  const found = reviewed.filter((r) => r.findings > 0).length;
  const lines = [
    `Re-reviewed ${reviewed.length} sampled passed ${noun(reviewed.length, "review")}: ${found} found a violation, ${failures.length} failed`,
    ...reviewed.map(
      (r) =>
        `  PR #${r.pr} at head ${r.head}: ${r.findings} ${noun(r.findings, "finding")}`,
    ),
    ...failures.map(
      (f) => `  PR #${f.pr} at head ${f.head}: failed (${f.reason})`,
    ),
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * Draws a sample of the passed reviews still waiting for a re-review and re-reviews
 * it, one Sonnet reader per head. The ledger and the ports are loaded only after
 * the size is accepted, so a refused size reads nothing and starts no pane.
 */
export async function reviewResampleRun(
  context: CommandContext,
  load: (backend: Backend) => Promise<ResampleIo>,
  random: () => number,
): Promise<number> {
  try {
    const size = sizeOf(context.options["size"]);
    const backend = await briefBackend(context.deps);
    const io = await load(backend);
    const sample = drawSample(resampleCandidates(io.events), size, random);
    const result =
      sample.length === 0
        ? { reviewed: [], failed: [] }
        : await new ResampleRun(io.ports, backend).run(sample);
    const output: ResampleOutput = { sample, ...result };
    context.deps.stdout(
      context.json ? `${JSON.stringify(output)}\n` : summaryOf(output),
    );
    return 0;
  } catch (error) {
    return failed(context, error);
  }
}
