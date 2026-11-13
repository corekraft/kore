import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { createMutate } from "./mutation.js";

// Docs: AGENTS.md "Mutations are serialized per environment."

const runner: Runner = {
  run: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
} as unknown as Runner;

let host: string;
let roots: string[] = [];
const checkout = async () => {
  const dir = await mkdtemp(join(tmpdir(), "kore-mutation-wt-"));
  roots.push(dir);
  return dir;
};
let previous: string | undefined;

beforeEach(async () => {
  host = await mkdtemp(join(tmpdir(), "kore-mutation-host-"));
  previous = process.env.KORE_HOST_ROOT;
  process.env.KORE_HOST_ROOT = host;
});

afterEach(async () => {
  if (previous === undefined) {
    delete process.env.KORE_HOST_ROOT;
  } else {
    process.env.KORE_HOST_ROOT = previous;
  }
  await Promise.all(
    [host, ...roots].map((dir) => rm(dir, { recursive: true, force: true })),
  );
  roots = [];
});

/** A worktree checkout of the environment named `name`, on cluster `cluster`. */
function worktree(root: string, name: string, cluster: string): Repository {
  return {
    root,
    environment: {
      name,
      kubeContext: `k3d-${cluster}`,
      k3d: { clusterName: cluster },
    },
  } as unknown as Repository;
}

function mutateFor(root: string, name = "local", cluster = "kore-local") {
  return createMutate({
    command: "local",
    action: "up",
    mutations: ["up"],
    environmentName: name,
    repository: worktree(root, name, cluster),
    runner,
  });
}

test("two worktrees mutating one cluster are serialized, not run side by side", async () => {
  const first = mutateFor(await checkout());
  const second = mutateFor(await checkout());
  const order: string[] = [];
  let release: () => void = () => undefined;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });

  const running = first("up a", async () => {
    order.push("a:start");
    await blocked;
    order.push("a:end");
    return 0;
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const refused = second("up b", async () => {
    order.push("b:start");
    return 0;
  });

  await expect(refused).rejects.toThrow(/kore-local/);
  expect(order).toEqual(["a:start"]);
  release();
  await running;
  expect(order).toEqual(["a:start", "a:end"]);
});

test("the lock is keyed by cluster name at a host path, not by worktree", async () => {
  const mutate = mutateFor(await checkout());
  let owner = "";
  await mutate("up", async () => {
    owner = await readFile(
      join(host, ".kore", "locks", "kore-local.lock"),
      "utf8",
    );
    return 0;
  });
  expect(JSON.parse(owner).pid).toBe(process.pid);
});

test("environments on different clusters do not block each other", async () => {
  const one = mutateFor(await checkout(), "local", "kore-local");
  const other = mutateFor(await checkout(), "scratch", "kore-scratch");
  let inner = false;
  await one("up", async () => {
    await other("up", async () => {
      inner = true;
      return 0;
    });
    return 0;
  });
  expect(inner).toBe(true);
});
