// Runs `hook context` over a real temporary repository for the context specs.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../src/cli/index.js";
import { testHarness } from "../../src/testing/index.js";
import { nodeFileSystem } from "../../src/runtime/index.js";
import type { FakeRunner } from "../../src/testing/index.js";

export const agents = `# AGENTS.md

- **One owner per resource.** Every resource has exactly one
  desired-state owner.
`;

export const repoPlan = `# Plan

## Step 2: Open

- [ ] **Bound output.** Cap hook output
  at 40 lines.
`;

const temps: string[] = [];
export const temp = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
};
export function cleanTemps(): void {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

export interface Outcome {
  code: number;
  out: string;
  err: string;
  runner: FakeRunner;
}

/** Runs `hook context` over a real repository root with the given stdin and config dir. */
export async function context(
  root: string,
  stdin: string,
  config?: string,
): Promise<Outcome> {
  const h = testHarness({
    env: config === undefined ? {} : { CLAUDE_CONFIG_DIR: config },
  });
  const deps = {
    ...h.deps,
    fs: nodeFileSystem,
    root: () => Promise.resolve(root),
    stdin: () => Promise.resolve(stdin),
  };
  const code = await run(["hook", "context"], deps);
  return { code, out: h.out(), err: h.err(), runner: h.runner };
}

export const additional = (outcome: Outcome): string =>
  (
    JSON.parse(outcome.out) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    }
  ).hookSpecificOutput.additionalContext;

export function repository(files: Record<string, string> = {}): string {
  const root = temp("kore-context-");
  mkdirSync(join(root, "infra/plans"), { recursive: true });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}
