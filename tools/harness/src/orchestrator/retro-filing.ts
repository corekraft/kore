import { SAFETY_PATTERNS } from "../idea/index.js";
import {
  RETRO_CAP,
  checkBatch,
  contentOf,
  readProposals,
  type Proposal,
} from "./retro-proposals.js";

/** Every side effect filing has; each is an existing harness tool, faked in specs. */
export interface FilingPorts {
  /** Whether the local overlay turns the automatic retro on. */
  flagOn(): Promise<boolean>;
  /** The flow report's metric names, which a proposal's metric must be one of. */
  metricNames(): Promise<string[]>;
  /** A short hex digest of the text. */
  hash(text: string): string;
  /** `idea new --slug <key>` through the idea domain; an existing slug is returned untouched, not created again. */
  file(
    slug: string,
    proposal: Proposal,
  ): Promise<{ created: boolean; number: string }>;
  /** Records the idea-filed event, which the flow report maps to the refine stage. */
  recordFiled(number: string, key: string): Promise<void>;
  /** Records the proposals the cap dropped, once per trigger. */
  recordDropped(trigger: string, count: number): Promise<void>;
}

export type FilingResult =
  | { status: "flag-off" }
  | { status: "refused"; error: string }
  | { status: "filed"; filed: number; existing: number; dropped: number };

/**
 * Files a collected retro pane's proposals as ideas while `automatic-retro` is
 * on. The pane's JSON is untrusted: the whole batch is checked first and one bad
 * item files nothing. At most 5 are filed, each under its trigger id plus a
 * content hash, so a rerun finds them and files nothing new. It never approves
 * an idea; auto-approval stays with the qualifier.
 */
export class RetroFiling {
  constructor(private readonly ports: FilingPorts) {}

  async run(trigger: string, pane: string): Promise<FilingResult> {
    const { ports } = this;
    if (!(await ports.flagOn())) {
      return { status: "flag-off" };
    }
    const read = readProposals(pane);
    if (!read.ok) {
      return { status: "refused", error: read.error };
    }
    const checked = checkBatch(read.batch, await ports.metricNames(), [
      ...SAFETY_PATTERNS,
    ]);
    if (!checked.ok) {
      return { status: "refused", error: checked.error };
    }
    const kept = checked.proposals.slice(0, RETRO_CAP);
    const dropped = checked.proposals.length - kept.length;
    let filed = 0;
    for (const proposal of kept) {
      const key = `${trigger}-${ports.hash(contentOf(proposal))}`;
      const result = await ports.file(key, proposal);
      if (result.created) {
        await ports.recordFiled(result.number, key);
        filed += 1;
      }
    }
    if (dropped > 0) {
      await ports.recordDropped(trigger, dropped);
    }
    return { status: "filed", filed, existing: kept.length - filed, dropped };
  }
}
