import { IdeaRepository } from "../idea/index.js";
import type { Clock, FileSystem } from "../runtime/index.js";
import { findProof } from "./proof.js";
import { environments, readOverlay } from "./overlay.js";

export interface UnprovenFlag {
  flag: string;
  environment: string;
  path: string;
}

/** Every flag that is on in an environment overlay without a confirmed live-run verification outcome. */
export async function unprovenFlags(
  fs: FileSystem,
  clock: Clock,
  base: string,
): Promise<UnprovenFlag[]> {
  const repo = new IdeaRepository(fs, clock, base);
  const unproven: UnprovenFlag[] = [];
  for (const environment of await environments(fs, base)) {
    const overlay = await readOverlay(fs, base, environment);
    for (const [flag, on] of Object.entries(overlay.features)) {
      if (on && (await findProof(repo, flag, environment)) === undefined) {
        unproven.push({ flag, environment, path: overlay.path });
      }
    }
  }
  return unproven;
}

/** The audit's report line for one unproven flag. */
export function unprovenLine(u: UnprovenFlag): string {
  return `Flag ${u.flag} is on in ${u.environment} (${u.path}) with no verification outcome. Set it back to false, then turn it on with \`harness flag activate ${u.flag} --environment ${u.environment}\` once a live run is recorded.`;
}
