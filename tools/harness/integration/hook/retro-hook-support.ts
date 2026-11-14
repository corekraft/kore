// Helpers for the `harness hook retro-scan` integration specs: a temporary repository root
// and a run of the hook through the CLI with fake dependencies.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../src/cli/index.js";
import { testHarness } from "../../src/testing/index.js";
import { INVENTORY_PATH } from "../../src/guardrail/index.js";
import { nodeFileSystem } from "../../src/runtime/index.js";

const temps: string[] = [];

/** Removes every temporary directory made by these helpers; call it after each test. */
export function removeTemps(): void {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

export const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "kore-retro-hook-"));
  temps.push(dir);
  return dir;
};

/** A repository root with skills, a guardrail inventory, and optionally a retrospective marker. */
export function repoRoot(
  parts: { skills?: boolean; marker?: string; guard?: boolean } = {},
): string {
  const { skills = true, marker, guard = true } = parts;
  const root = temp();
  mkdirSync(join(root, "infra", "plans"), { recursive: true });
  if (guard) {
    mkdirSync(join(root, ".claude"), { recursive: true });
    const entry = (rule: string, mode: string) => ({
      rule,
      kind: "bash",
      mode,
      owner: "guard.ts",
    });
    writeFileSync(
      join(root, INVENTORY_PATH),
      JSON.stringify({
        guardrails: [
          entry("image-digest", "audit"),
          entry("sample-audit", "audit"),
          entry("unquoted-glob", "audit"),
          entry("enforced-rule", "enforce"),
        ],
      }),
    );
  }
  if (skills) {
    mkdirSync(join(root, "skills", "alpha-skill"), { recursive: true });
    writeFileSync(join(root, "skills", "alpha-skill", "SKILL.md"), "---\n");
    writeFileSync(join(root, "skills", "README.md"), "not a skill\n");
    // A folder without SKILL.md, like skills/bin, is not a skill.
    mkdirSync(join(root, "skills", "bin"), { recursive: true });
  }
  if (marker) {
    writeFileSync(
      join(root, "infra", "plans", "3-plan.md"),
      `Last retrospective: ${marker}\n`,
    );
  }
  return root;
}

/** One guard block location in `guardEvidence`: the session, its transcript line and an excerpt. */
export interface RetroEvidence {
  session: string;
  line: number;
  excerpt: string;
}

/** The fields of a `harness hook retro-scan` report that the integration specs read. */
export interface RetroReport {
  guards: Record<string, { blocks: number; warnings: number }>;
  guardEvidence?: Record<string, RetroEvidence[]>;
}

/** Parses the JSON a `retro-scan` run printed; the one narrowing for the report shape. */
export function parseReport(out: string): RetroReport {
  return JSON.parse(out) as RetroReport;
}

export async function retro(root: string, args: string[], home = temp()) {
  const h = testHarness({ env: { HOME: home } });
  h.deps.fs = nodeFileSystem;
  h.deps.root = () => Promise.resolve(root);
  h.deps.stdin = () => Promise.reject(new Error("stdin must not be read"));
  const code = await run(["hook", "retro-scan", ...args], h.deps);
  return { code, out: h.out(), err: h.err(), runner: h.runner };
}
