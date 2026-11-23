import { IdeaRepository } from "../idea/index.js";
import type { Clock, FileSystem } from "../runtime/index.js";
import { UNRECORDED_WINDOWS, type ProofSources } from "./app-windows.js";
import { findProof } from "./proof.js";
import { environments, readOverlay, type Overlay } from "./overlay.js";

export interface UnprovenFlag {
  flag: string;
  environment: string;
  path: string;
}

/** A flag that is on because the owner waived its live run, not because a run proved it. */
export interface WaivedFlag extends UnprovenFlag {
  idea: string;
  proof: string;
}

export interface ProofAudit {
  unproven: UnprovenFlag[];
  waived: WaivedFlag[];
}

/** Every flag that is on in an environment overlay, sorted by what proves it: nothing, or an owner waiver. A live run needs no mention. */
export async function proofAudit(
  fs: FileSystem,
  clock: Clock,
  base: string,
): Promise<ProofAudit> {
  const repo = new IdeaRepository(fs, clock, base);
  const audit: ProofAudit = { unproven: [], waived: [] };
  const overlays: Overlay[] = [];
  for (const environment of await environments(fs, base)) {
    overlays.push(await readOverlay(fs, base, environment));
  }
  // A flag an overlay names is a platform flag, so no platform window ever counts for it (ADR 0174).
  const platform = new Set(overlays.flatMap((o) => Object.keys(o.features)));
  const sources: ProofSources = {
    isAppFlag: (flag) => !platform.has(flag),
    windows: UNRECORDED_WINDOWS,
  };
  for (const overlay of overlays) {
    for (const [flag, on] of Object.entries(overlay.features)) {
      if (!on) {
        continue;
      }
      const proof = await findProof(repo, flag, overlay.environment, sources);
      if (proof === undefined) {
        audit.unproven.push({
          flag,
          environment: overlay.environment,
          path: overlay.path,
        });
      } else if (proof.source === "owner-waiver") {
        audit.waived.push({
          flag,
          environment: overlay.environment,
          path: overlay.path,
          idea: proof.idea,
          proof: proof.path,
        });
      }
    }
  }
  return audit;
}

/** Every flag that is on in an environment overlay with neither a confirmed live-run verification outcome nor an owner waiver. */
export async function unprovenFlags(
  fs: FileSystem,
  clock: Clock,
  base: string,
): Promise<UnprovenFlag[]> {
  return (await proofAudit(fs, clock, base)).unproven;
}

/** The audit's report line for one unproven flag. */
export function unprovenLine(u: UnprovenFlag): string {
  return `Flag ${u.flag} is on in ${u.environment} (${u.path}) with no verification outcome. Set it back to false, then turn it on with \`harness flag activate ${u.flag} --environment ${u.environment}\` once a live run is recorded.`;
}

/** The audit's report line for a flag that rests on an owner waiver. */
export function waivedLine(w: WaivedFlag): string {
  return `Flag ${w.flag} is on in ${w.environment} (${w.path}) under an owner waiver, not a live run: ${w.proof}.`;
}
