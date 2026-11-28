// The files a flag's retirement rewrites: each environment overlay that declares the flag, and the manifest (ADR 0149). Split out of flag-retire-command.ts to keep each module within the lint cap.

import {
  FLAG_MANIFEST,
  environments,
  readOverlay,
  withoutFlag,
  withoutManifestEntry,
} from "../flag/index.js";
import type { FileSystem } from "../runtime/index.js";

/** One file a retirement rewrites: its path relative to the repository root, and the text it will hold. */
export interface RetireEdit {
  path: string;
  text: string;
}

export interface RetireEdits {
  overlays: RetireEdit[];
  manifest: RetireEdit;
}

/**
 * The rewritten text of every overlay that declares the flag, and of the
 * manifest without its entry. Nothing is written here: the command writes the
 * edits only after the eligibility check has passed.
 */
export async function retireEdits(
  fs: FileSystem,
  base: string,
  flag: string,
  manifestText: string,
): Promise<RetireEdits> {
  const overlays: RetireEdit[] = [];
  for (const name of await environments(fs, base)) {
    const overlay = await readOverlay(fs, base, name);
    if (Object.hasOwn(overlay.features, flag)) {
      overlays.push({ path: overlay.path, text: withoutFlag(overlay, flag) });
    }
  }
  return {
    overlays,
    manifest: {
      path: FLAG_MANIFEST,
      text: withoutManifestEntry(manifestText, flag),
    },
  };
}
