#!/usr/bin/env node
// Docs: docs/decisions/0088-declarative-probe-patches-through-a-helm-post-renderer.md
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import type { ProbePatch } from "../config/index.js";
import { applyProbePatches } from "../platform/patches.js";

/** The Helm post-renderer: patches the manifest stream with the catalog's probe patches. */
export function postRender(manifests: string, args: string[]): string {
  if (args.length !== 1) {
    throw new Error("kore-patch expects the patches as one JSON argument");
  }
  let patches: unknown;
  try {
    patches = JSON.parse(args[0]!);
  } catch {
    throw new Error("kore-patch: the patches argument is not valid JSON");
  }
  if (!Array.isArray(patches)) {
    throw new Error("kore-patch: the patches argument must be a JSON array");
  }
  return applyProbePatches(manifests, patches as ProbePatch[]);
}

// Node resolves import.meta.url to the real path, so a symlinked checkout needs
// the same resolution for argv[1], or the entry would write nothing and exit 0.
function isEntry(): boolean {
  try {
    return (
      import.meta.url ===
      pathToFileURL(realpathSync(process.argv[1] ?? "")).href
    );
  } catch {
    return false;
  }
}

if (isEntry()) {
  try {
    process.stdout.write(
      postRender(readFileSync(0, "utf8"), process.argv.slice(2)),
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
