import { mkdirSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
function lifecycleRunner(options: {
  running?: number | undefined;
  retained?: boolean;
}) {
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
  const order = text(calls).filter((line) => / delete /.test(line));
  expect(order).toEqual([
    expect.stringContaining(
      "kubectl --context k3d-kore-local delete postgresqlinstances.platform.kore.dev",
    ),
    expect.stringContaining(
      "kubectl --context k3d-kore-local delete pvc --all-namespaces",
    ),
    "k3d cluster delete kore-local",
  ]);
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
  expect(calls).toEqual([]);
});

test("destroy on an absent cluster is a no-op: no data can exist and no delete is issued", async () => {
  for (const options of [
    { yes: true, purgeData: false },
    { yes: true, purgeData: true },
    { yes: false, purgeData: false },
  ]) {
    const { runner, calls } = lifecycleRunner({});
    await clusterDestroy(await k3dRepository(), runner, options);
    expect(text(calls)).toEqual(["k3d cluster list --output json"]);
  }
});

test("stop on a stopped or absent cluster returns without error and stops nothing", async () => {
  for (const running of [0, undefined]) {
    const { runner, calls } = lifecycleRunner({ running });
    await clusterStop(await k3dRepository(), runner);
    expect(text(calls)).toEqual(["k3d cluster list --output json"]);
  }
});

test("destroy removes only this cluster's registry trust directory under the home", async () => {
  const home = mkdtempSync(join(tmpdir(), "kore-k3d-destroy-home-"));
  const mine = join(home, ".kore", "k3d", "kore-local", "registry-trust");
  const other = join(home, ".kore", "k3d", "other-cluster");
  mkdirSync(mine, { recursive: true });
  mkdirSync(other, { recursive: true });
  writeFileSync(join(mine, "ca.crt"), "public");
  const { runner } = lifecycleRunner({ running: 1 });
  await clusterDestroy(
    await k3dRepository(),
    runner,
    { yes: true, purgeData: false },
    home,
  );
  expect(existsSync(join(home, ".kore", "k3d", "kore-local"))).toBe(false);
  expect(existsSync(other)).toBe(true);
});

test("a refused destroy leaves the registry trust directory in place", async () => {
  const home = mkdtempSync(join(tmpdir(), "kore-k3d-destroy-home-"));
  const mine = join(home, ".kore", "k3d", "kore-local", "registry-trust");
  mkdirSync(mine, { recursive: true });
  const { runner } = lifecycleRunner({ running: 1 });
  await expect(
    clusterDestroy(
      await k3dRepository(),
      runner,
      { yes: false, purgeData: false },
      home,
    ),
  ).rejects.toThrow(/requires --yes/);
  expect(existsSync(mine)).toBe(true);
});
