// Builds the harness bundle (ADR 0092). The bundle is written beside its
// destination and renamed into place, so a hook that reads it mid-build sees
// the old complete file or the new one, never a half-written one (the guard
// would fail open on a truncated bundle).
// Usage: node build.mjs [outfile]   (default ../../skills/bin/harness.mjs)
import { build } from "esbuild";
import { renameSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outfile = resolve(
  process.argv[2] ?? resolve(here, "../../skills/bin/harness.mjs"),
);
const temp = `${outfile}.${process.pid}.tmp`;

try {
  await build({
    entryPoints: [resolve(here, "src/main.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node26",
    legalComments: "none",
    outfile: temp,
    logLevel: "error",
  });
  renameSync(temp, outfile);
} catch (error) {
  rmSync(temp, { force: true });
  throw error;
}
