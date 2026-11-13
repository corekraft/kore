import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Repository } from "../config/index.js";
import { hostRoot } from "../runtime/host-locks.js";

// Docs: AGENTS.md "One owner per resource."

export interface ForwardOwner {
  /** The forward's process id. */
  pid: number;
  /** The worktree that started it. */
  root: string;
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
  const owner: ForwardOwner = { pid, root: repository.root };
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
    };
    return Number.isInteger(owner.pid) && typeof owner.root === "string"
      ? { pid: owner.pid as number, root: owner.root }
      : undefined;
  } catch {
    return undefined;
  }
}

export async function clearForwardOwner(context: string): Promise<void> {
  await rm(ownerFile(context), { force: true });
}

/** Whether a worktree other than `root`, which still exists, owns the forward. */
export function ownedByAnother(
  owner: ForwardOwner | undefined,
  root: string,
): owner is ForwardOwner {
  return owner !== undefined && owner.root !== root && existsSync(owner.root);
}
