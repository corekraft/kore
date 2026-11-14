import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";
import { checkProtected } from "../../src/hook/index.js";

/** The temporary worktree the protected-guard cases run in; set up before each file's cases. */
export const worktree = { root: "" };

export const setUp = (): void => {
  worktree.root = mkdtempSync(join(tmpdir(), "guard-protected-"));
  const hooks = join(worktree.root, ".claude", "hooks");
  mkdirSync(hooks, { recursive: true });
  for (const file of ["harness.sh", "a.test.mjs", "b.test.mjs", "y.test.mjs"]) {
    writeFileSync(join(hooks, file), "");
  }
  mkdirSync(join(hooks, "x.test.mjs"));
  mkdirSync(join(hooks, "l.test.mjs"));
  symlinkSync("harness.sh", join(hooks, "linked.test.mjs"));
  mkdirSync(join(worktree.root, "scratch", "dir"), { recursive: true });
  writeFileSync(join(worktree.root, "scratch", "file"), "");
  symlinkSync("dir", join(worktree.root, "scratch", "link"));
};

export const tearDown = (): void => {
  rmSync(worktree.root, { recursive: true, force: true });
};

/** The repository's own path in a case, /repo, replaced with the temporary root. */
export const at = (text: string) => text.replaceAll("/repo", worktree.root);
export const writer = (tool: string, input: Record<string, unknown>) =>
  checkProtected("writer", tool, input, worktree.root);
export const bash = (command: string) =>
  writer("Bash", { command: at(command) });
export const write = (file_path: string) =>
  writer("Write", { file_path: at(file_path), content: "x" });

export const guardRefusal = {
  action: "block",
  rule: "role-read-only",
  message: expect.stringContaining(
    "changes the guard bundle, a hook or the settings",
  ),
};
