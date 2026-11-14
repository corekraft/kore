import { expect, test } from "vitest";
import { CommandError } from "../runtime/index.js";
import { purgeRetainedResources, retainedResources } from "./retained.js";
import { commandLines, fakeRepository, fakeRunner } from "./cluster-support.js";

const RETAIN = "platform.kore.dev/retention=Retain";

function volume(
  name: string,
  storageClassName: string,
  claim?: { namespace: string; name: string },
) {
  return {
    metadata: { name },
    spec: { storageClassName, ...(claim ? { claimRef: claim } : {}) },
  };
}

/** The API answers: `queries` for the two retention lists, `volumes` for the PV list. */
function clusterWith(
  queries: { postgres?: string; pvc?: string },
  volumes: unknown = { items: [] },
) {
  return fakeRunner((_command, args) => {
    if (args.includes("persistentvolumes")) {
      return typeof volumes === "string" ? volumes : JSON.stringify(volumes);
    }
    if (args.includes("postgresqlinstances.platform.kore.dev")) {
      return queries.postgres ?? "";
    }
    return args.includes("pvc") ? (queries.pvc ?? "") : "";
  });
}

const repository = fakeRepository();

test("retained data is searched in every namespace by the retention label, then the persistent volumes, in the configured context", async () => {
  const { runner, run } = clusterWith({});
  await retainedResources(repository, runner);
  expect(commandLines(run)).toEqual([
    `kubectl --context k3d-kore-local get postgresqlinstances.platform.kore.dev --all-namespaces -l ${RETAIN} -o name`,
    `kubectl --context k3d-kore-local get pvc --all-namespaces -l ${RETAIN} -o name`,
    "kubectl --context k3d-kore-local get persistentvolumes -o json",
  ]);
});

test("a namespace scope replaces --all-namespaces in both label queries", async () => {
  const { runner, run } = clusterWith({});
  await retainedResources(repository, runner, "reference");
  expect(commandLines(run).slice(0, 2)).toEqual([
    `kubectl --context k3d-kore-local get postgresqlinstances.platform.kore.dev --namespace=reference -l ${RETAIN} -o name`,
    `kubectl --context k3d-kore-local get pvc --namespace=reference -l ${RETAIN} -o name`,
  ]);
});

test("retained names are trimmed, blank lines and duplicates dropped, and the result sorted", async () => {
  const { runner } = clusterWith(
    {
      postgres:
        " postgresqlinstance.platform.kore.dev/reference-db \npostgresqlinstance.platform.kore.dev/reference-db\n\n",
      pvc: "persistentvolumeclaim/cache\n",
    },
    { items: [volume("pvc-orphan", "kore-retained")] },
  );
  expect(await retainedResources(repository, runner)).toEqual([
    "persistentvolume/pvc-orphan",
    "persistentvolumeclaim/cache",
    "postgresqlinstance.platform.kore.dev/reference-db",
  ]);
});

test("a retained volume whose claim was already deleted still counts, and disposable volumes never do", async () => {
  const { runner } = clusterWith(
    {},
    {
      items: [
        volume("pvc-orphan", "kore-retained", {
          namespace: "reference",
          name: "reference-db-1",
        }),
        volume("pvc-disposable", "kore-standard", {
          namespace: "reference",
          name: "cache",
        }),
      ],
    },
  );
  expect(await retainedResources(repository, runner)).toEqual([
    "persistentvolume/pvc-orphan",
  ]);
});

test("a namespace scope reports only the volumes last bound in that namespace, not unbound ones", async () => {
  const volumes = {
    items: [
      volume("pvc-a", "kore-retained", {
        namespace: "reference",
        name: "db-1",
      }),
      volume("pvc-b", "kore-retained", { namespace: "other", name: "db-1" }),
      volume("pvc-unbound", "kore-retained"),
    ],
  };
  const { runner } = clusterWith({}, volumes);
  expect(await retainedResources(repository, runner, "reference")).toEqual([
    "persistentvolume/pvc-a",
  ]);
  expect(await retainedResources(repository, runner)).toEqual([
    "persistentvolume/pvc-a",
    "persistentvolume/pvc-b",
    "persistentvolume/pvc-unbound",
  ]);
});

test("an API that is not installed cannot hold retained data, so its missing resource type is no finding", async () => {
  const { runner } = fakeRunner((_command, args) => {
    if (args.includes("postgresqlinstances.platform.kore.dev")) {
      throw new CommandError("kubectl", args, {
        stdout: "",
        stderr:
          'error: the server doesn\'t have a resource type "postgresqlinstances"',
        code: 1,
      });
    }
    return args.includes("persistentvolumes") ? '{"items":[]}' : "pvc/cache\n";
  });
  expect(await retainedResources(repository, runner)).toEqual(["pvc/cache"]);
});

test("a failing label query that is not a missing API refuses, and the remaining queries are not run", async () => {
  const unreachable = new CommandError("kubectl", ["get"], {
    stdout: "",
    stderr: "Unable to connect to the server: i/o timeout",
    code: 1,
  });
  const { runner, run } = fakeRunner(() => {
    throw unreachable;
  });
  await expect(retainedResources(repository, runner)).rejects.toBe(unreachable);
  expect(run).toHaveBeenCalledTimes(1);
});

test("an unreadable persistent volume list refuses, rather than counting as no retained data", async () => {
  const { runner } = clusterWith({}, "not json");
  await expect(retainedResources(repository, runner)).rejects.toThrow(
    /could not read the PersistentVolume list: .*Check the cluster with kubectl before destroying anything\./,
  );
});

test("a persistent volume list that fails to run refuses with the command's own error", async () => {
  const unreachable = new CommandError("kubectl", ["get"], {
    stdout: "",
    stderr: "Unable to connect to the server",
    code: 1,
  });
  const { runner } = fakeRunner((_command, args) => {
    if (args.includes("persistentvolumes")) {
      throw unreachable;
    }
    return "";
  });
  await expect(retainedResources(repository, runner)).rejects.toBe(unreachable);
});

test("an empty persistent volume list holds no retained volumes", async () => {
  const { runner } = clusterWith({}, "");
  expect(await retainedResources(repository, runner)).toEqual([]);
});

test("purging deletes the PostgreSQL instances with --wait and the claims without it, by retention label", async () => {
  const { runner, run } = fakeRunner();
  await purgeRetainedResources(repository, runner);
  expect(commandLines(run)).toEqual([
    `kubectl --context k3d-kore-local delete postgresqlinstances.platform.kore.dev --all-namespaces --selector ${RETAIN} --ignore-not-found --wait`,
    `kubectl --context k3d-kore-local delete pvc --all-namespaces --selector ${RETAIN} --ignore-not-found --wait=false`,
  ]);
});

test("a PostgreSQL CRD that was never installed is skipped, and the claims are still purged", async () => {
  const { runner, run } = fakeRunner((_command, args) => {
    if (args.includes("postgresqlinstances.platform.kore.dev")) {
      throw new Error(
        'the server doesn\'t have a resource type "postgresqlinstances"',
      );
    }
    return "";
  });
  await purgeRetainedResources(repository, runner);
  expect(run).toHaveBeenCalledTimes(2);
  expect(commandLines(run)[1]).toContain("delete pvc");
});

test("a purge failure other than a missing API stops the purge before any claim is deleted", async () => {
  const { runner, run } = fakeRunner(() => {
    throw new Error("Unable to connect to the server");
  });
  await expect(purgeRetainedResources(repository, runner)).rejects.toThrow(
    "Unable to connect to the server",
  );
  expect(run).toHaveBeenCalledTimes(1);
  expect(commandLines(run)[0]).toContain("delete postgresqlinstances");
});
