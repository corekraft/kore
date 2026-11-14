import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Integration specs run beside the same host as live runs, so they must not write
// host locks or ownership records under the real home directory. A spec that needs
// a host root of its own sets KORE_HOST_ROOT itself. Process listings are not mocked
// here: an integration spec may run real processes (the unit setup in
// src/test-setup-support.ts is what hides them from unit tests).
if (process.env.KORE_HOST_ROOT === undefined) {
  const host = mkdtempSync(join(tmpdir(), "kore-integration-host-"));
  process.env.KORE_HOST_ROOT = host;
  process.on("exit", () => rmSync(host, { recursive: true, force: true }));
}
