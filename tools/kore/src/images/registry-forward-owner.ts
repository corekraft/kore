import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Repository } from "../config/index.js";
import { hostRoot, processAlive } from "../runtime/index.js";

// Docs: AGENTS.md "One owner per resource."

export interface ForwardOwner {
  /** The forward's process id. */
  pid: number;
  /** The worktree that started it. */
  root: string;
  /** The kore process that started it. */
  starter: number;
}

/**
 * Where the owner of a context's registry port-forward is recorded. The
 * forward is one host process on one port, so its owner is kept at a host
 * path, not in any worktree.
 */
function ownerFile(context: string): string {
  return join(hostRoot(), ".kore", "registry-forward", `${context}.json`);
}

/** Records `repository`'s worktree as the owner of the forward it just started. */
export async function recordForwardOwner(
  repository: Repository,
  pid: number,
): Promise<void> {
  const file = ownerFile(repository.environment.kubeContext);
  await mkdir(dirname(file), { recursive: true });
  const owner: ForwardOwner = {
    pid,
    root: repository.root,
    starter: process.pid,
  };
  await writeFile(file, JSON.stringify(owner));
}

/** The recorded owner, or undefined when none was recorded or it is unreadable. */
export async function readForwardOwner(
  context: string,
): Promise<ForwardOwner | undefined> {
  try {
    const owner = JSON.parse(await readFile(ownerFile(context), "utf8")) as {
      pid?: unknown;
      root?: unknown;
      starter?: unknown;
    };
    return Number.isInteger(owner.pid) &&
      typeof owner.root === "string" &&
      Number.isInteger(owner.starter)
      ? {
          pid: owner.pid as number,
          root: owner.root,
          starter: owner.starter as number,
        }
      : undefined;
  } catch {
    return undefined;
  }
}

export async function clearForwardOwner(context: string): Promise<void> {
  await rm(ownerFile(context), { force: true });
}

/**
 * Why `root`'s stop must leave the recorded forward alone, or undefined when it
 * may stop it: another worktree that still exists started it, or another kore
 * process still running in this worktree did. A starter that has exited, or a
 * worktree that is gone, no longer owns anything.
 */
export function ownershipConflict(
  owner: ForwardOwner | undefined,
  root: string,
): string | undefined {
  if (owner === undefined) {
    return undefined;
  }
  if (owner.root !== root) {
    return existsSync(owner.root)
      ? `it was started from ${owner.root}, so stop it from there`
      : undefined;
  }
  return owner.starter !== process.pid && processAlive(owner.starter)
    ? `it was started by kore process ${owner.starter} in this worktree, so stop it from there`
    : undefined;
}
