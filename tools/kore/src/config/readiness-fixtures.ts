import type { ReadinessManifest } from "./types.js";

/** A readiness manifest that requires exactly these components (test fixture). */
export function readinessFor(...components: string[]): ReadinessManifest {
  return {
    version: 1,
    requirements: [
      { name: "all", step: 7, capability: "controller", components },
    ],
  };
}
