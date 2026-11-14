import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { Repository } from "../src/config/index.js";
import type { Runner } from "../src/runtime/index.js";
import { createMutate } from "../src/cli/mutation.js";

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
  delete process.env.KORE_LOCK_WAIT_MS;
  previous = process.env.KORE_HOST_ROOT;
  process.env.KORE_HOST_ROOT = host;
});

afterEach(async () => {
  delete process.env.KORE_LOCK_WAIT_MS;
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

function mutateFor(
  root: string,
  name = "local",
  cluster = "kore-local",
  action = "up",
) {
  return createMutate({
    command: "local",
    action,
    mutations: [action],
    environmentName: name,
    repository: worktree(root, name, cluster),
    runner,
  });
}

test("two worktrees mutating one cluster are serialized: the second waits, then runs", async () => {
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
  const waiting = second("up b", async () => {
    order.push("b:start");
    order.push("b:end");
    return 0;
  });
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(order).toEqual(["a:start"]);

  release();
  await Promise.all([running, waiting]);
  expect(order).toEqual(["a:start", "a:end", "b:start", "b:end"]);
});

test("a mutation that outwaits its holder is refused, naming the cluster", async () => {
  process.env.KORE_LOCK_WAIT_MS = "100";
  const first = mutateFor(await checkout(), "local", "kore-local", "stop");
  const second = mutateFor(await checkout(), "local", "kore-local", "stop");
  let release: () => void = () => undefined;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const running = first("up a", async () => {
    await blocked;
    return 0;
  });
  await new Promise((resolve) => setTimeout(resolve, 20));

  await expect(second("up b", async () => 0)).rejects.toThrow(/kore-local/);
  release();
  await running;
});

test("a live run that outwaits the host lease is refused, naming the lease", async () => {
  process.env.KORE_LOCK_WAIT_MS = "100";
  const first = mutateFor(await checkout(), "local", "kore-local");
  const second = mutateFor(await checkout(), "scratch", "kore-scratch");
  let release: () => void = () => undefined;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const running = first("up a", async () => {
    await blocked;
    return 0;
  });
  await new Promise((resolve) => setTimeout(resolve, 20));

  await expect(second("up b", async () => 0)).rejects.toThrow(/host-lease/);
  release();
  await running;
});

test("kore local up holds the exclusive host lease; other mutations do not", async () => {
  const lease = join(host, ".kore", "locks", "host-lease.lock");
  const held = async (action: string, mutations: string[]) => {
    let present = false;
    await createMutate({
      command: "local",
      action,
      mutations,
      environmentName: "local",
      repository: worktree(await checkout(), "local", "kore-local"),
      runner,
    })(action, async () => {
      present = await access(lease).then(
        () => true,
        () => false,
      );
      return 0;
    });
    return present;
  };

  expect(await held("up", ["up"])).toBe(true);
  expect(await held("stop", ["stop"])).toBe(false);
  await expect(access(lease)).rejects.toThrow();
});

test("a live run on another cluster waits for the host lease instead of loading the host beside it", async () => {
  const first = mutateFor(await checkout(), "local", "kore-local");
  const second = mutateFor(await checkout(), "scratch", "kore-scratch");
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
  const waiting = second("up b", async () => {
    order.push("b:start");
    return 0;
  });
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(order).toEqual(["a:start"]);

  release();
  await Promise.all([running, waiting]);
  expect(order).toEqual(["a:start", "a:end", "b:start"]);
});

test("a lock wait that is not a number is refused before anything is locked", async () => {
  for (const bad of ["", "10m", "-5"]) {
    process.env.KORE_LOCK_WAIT_MS = bad;
    await expect(
      mutateFor(await checkout())("up", async () => 0),
    ).rejects.toThrow(/KORE_LOCK_WAIT_MS/);
  }
  await expect(access(join(host, ".kore", "locks"))).rejects.toThrow();
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
  const one = mutateFor(await checkout(), "local", "kore-local", "stop");
  const other = mutateFor(await checkout(), "scratch", "kore-scratch", "stop");
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
