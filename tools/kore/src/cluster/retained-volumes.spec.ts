import { loadMinikubeLocal } from "../config/minikube-local-support.js";
import assert from "node:assert/strict";
import { test } from "vitest";
import { retainedResources } from "./retained.js";

import { CommandError } from "../runtime/index.js";

function volume(
  name: string,
  storageClassName: string,
  claim?: { namespace: string; name: string },
): object {
  return {
    metadata: { name },
    spec: { storageClassName, ...(claim ? { claimRef: claim } : {}) },
  };
}

function runnerWithVolumes(items: object[] | Error) {
  const calls: string[][] = [];
  return {
    calls,
    async run(command: string, args: readonly string[]) {
      calls.push([command, ...args]);
      if (args.includes("persistentvolumes")) {
        if (items instanceof Error) {
          throw items;
        }
        return { stdout: JSON.stringify({ items }), stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  };
}

test("a retained volume whose claim was already deleted still counts as retained data", async () => {
  const repository = await loadMinikubeLocal();
  const runner = runnerWithVolumes([
    volume("pvc-orphan", "kore-retained", {
      namespace: "reference",
      name: "reference-db-1",
    }),
    volume("pvc-disposable", "kore-standard", {
      namespace: "reference",
      name: "cache",
    }),
  ]);

  assert.deepEqual(await retainedResources(repository, runner), [
    "persistentvolume/pvc-orphan",
  ]);
  const query = runner.calls.find((call) => call.includes("persistentvolumes"));
  assert.ok(query?.includes("--context"));
  assert.ok(query?.includes("kore-local"));
  assert.equal(
    runner.calls.some((call) => call.includes("delete")),
    false,
  );
});

test("namespace-scoped discovery reports only volumes last bound in that namespace", async () => {
  const repository = await loadMinikubeLocal();
  const runner = runnerWithVolumes([
    volume("pvc-a", "kore-retained", { namespace: "reference", name: "db-1" }),
    volume("pvc-b", "kore-retained", { namespace: "other", name: "db-1" }),
    volume("pvc-unbound", "kore-retained"),
  ]);

  assert.deepEqual(await retainedResources(repository, runner, "reference"), [
    "persistentvolume/pvc-a",
  ]);
  assert.deepEqual(await retainedResources(repository, runner), [
    "persistentvolume/pvc-a",
    "persistentvolume/pvc-b",
    "persistentvolume/pvc-unbound",
  ]);
});

test("an unreadable volume list blocks destroy instead of counting as no retained data", async () => {
  const repository = await loadMinikubeLocal();
  const unreachable = new CommandError("kubectl", ["get"], {
    stdout: "",
    stderr: "Unable to connect to the server: i/o timeout",
    code: 1,
  });
  await assert.rejects(
    retainedResources(repository, runnerWithVolumes(unreachable)),
    /Unable to connect/,
  );
  const garbled = {
    async run(_command: string, args: readonly string[]) {
      return {
        stdout: args.includes("persistentvolumes") ? "not json" : "",
        stderr: "",
        code: 0,
      };
    },
  };
  await assert.rejects(
    retainedResources(repository, garbled),
    /could not read the PersistentVolume list/,
  );
});
