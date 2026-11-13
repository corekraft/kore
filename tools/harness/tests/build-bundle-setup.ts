import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The bundle is a build output (ADR 0092), so a run that reads it builds it
// first: a fresh worktree and CI both start without one.
export default function setup(): void {
  const harnessRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  execFileSync("npm", ["run", "build", "--silent"], {
    cwd: harnessRoot,
    stdio: "inherit",
  });
}
