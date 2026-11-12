import { expect, test } from "vitest";
import type { Runner } from "../runtime/index.js";
import { clusterDestroy, clusterStop } from "./cluster.js";
import { fakeRunner, k3dRepository, ok, text } from "./k3d-cluster.fixtures.js";

const retainedPv = JSON.stringify({
  items: [
    {
      metadata: { name: "pv-1" },
      spec: {
        storageClassName: "kore-retained",
        claimRef: { namespace: "app" },
      },
    },
  ],
});

/** The k3d fake, with kubectl answering the retained-data queries. */
function lifecycleRunner(options: { running?: number; retained?: boolean }) {
  const { runner: base, calls } = fakeRunner(options.running);
  const runner: Runner = {
    async run(command, args, runOptions) {
      if (command === "kubectl" && args.includes("persistentvolumes")) {
        calls.push({ command, args });
        return ok(options.retained ? retainedPv : '{"items":[]}');
      }
      if (command === "kubectl" && args.includes("-l")) {
        calls.push({ command, args });
        return ok("");
      }
      return base.run(command, args, runOptions);
    },
  };
  return { runner, calls };
}

const deletes = (calls: Parameters<typeof text>[0]) =>
  text(calls).filter((line) => line.startsWith("k3d cluster delete"));

test("stop issues k3d cluster stop for the configured cluster and keeps data", async () => {
  const { runner, calls } = lifecycleRunner({ running: 1 });
  await clusterStop(await k3dRepository(), runner);
  expect(text(calls)).toContain("k3d cluster stop kore-local");
  expect(deletes(calls)).toEqual([]);
});

test("destroy without --yes issues no k3d delete", async () => {
  const { runner, calls } = lifecycleRunner({ running: 1 });
  await expect(
    clusterDestroy(await k3dRepository(), runner, {
      yes: false,
      purgeData: false,
    }),
  ).rejects.toThrow(/requires --yes/);
  expect(deletes(calls)).toEqual([]);
});

test("destroy refuses retained data without --purge-data, even with --yes", async () => {
  const { runner, calls } = lifecycleRunner({ running: 1, retained: true });
  await expect(
    clusterDestroy(await k3dRepository(), runner, {
      yes: true,
      purgeData: false,
    }),
  ).rejects.toThrow(/retained data[\s\S]*persistentvolume\/pv-1/);
  expect(deletes(calls)).toEqual([]);
});

test("destroy refuses a stopped cluster whose retained data cannot be verified", async () => {
  const { runner, calls } = lifecycleRunner({ running: 0 });
  await expect(
    clusterDestroy(await k3dRepository(), runner, {
      yes: true,
      purgeData: false,
    }),
  ).rejects.toThrow(/retained data cannot be verified/);
  expect(deletes(calls)).toEqual([]);
});

test("destroy with --yes and no retained data deletes the configured cluster", async () => {
  const { runner, calls } = lifecycleRunner({ running: 1 });
  await clusterDestroy(await k3dRepository(), runner, {
    yes: true,
    purgeData: false,
  });
  expect(deletes(calls)).toEqual(["k3d cluster delete kore-local"]);
});

test("destroy with both opt-ins purges retained data and deletes the cluster", async () => {
  const { runner, calls } = lifecycleRunner({ running: 1, retained: true });
  await clusterDestroy(await k3dRepository(), runner, {
    yes: true,
    purgeData: true,
  });
  expect(deletes(calls)).toEqual(["k3d cluster delete kore-local"]);
  expect(text(calls).at(-1)).toBe("k3d cluster delete kore-local");
});

test("destroy with --purge-data but no --yes still issues no delete", async () => {
  const { runner, calls } = lifecycleRunner({ running: 1, retained: true });
  await expect(
    clusterDestroy(await k3dRepository(), runner, {
      yes: false,
      purgeData: true,
    }),
  ).rejects.toThrow(/requires --yes/);
  expect(deletes(calls)).toEqual([]);
});

test("destroy refuses a cluster/context mismatch even with both opt-ins", async () => {
  const repository = await k3dRepository();
  const mismatched = {
    ...repository,
    environment: { ...repository.environment, kubeContext: "other" },
  };
  const { runner, calls } = lifecycleRunner({ running: 1 });
  await expect(
    clusterDestroy(mismatched, runner, { yes: true, purgeData: true }),
  ).rejects.toThrow(/unexpected cluster\/context pair/);
  expect(deletes(calls)).toEqual([]);
});
