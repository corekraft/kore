// Writes the test-budget report to disk for the vitest configs, creating its directory.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function writeBudgetReport(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
