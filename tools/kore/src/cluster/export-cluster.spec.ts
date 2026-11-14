import { expect, test } from "vitest";
import {
  DATABASE,
  RETAIN_SELECTOR,
  execArgs,
  retainedClusters,
} from "./export-cluster.js";
import { commandLines, fakeRepository, fakeRunner } from "./cluster-support.js";

test("the retention selector and database name are the contract the dump and restore share", () => {
  expect(RETAIN_SELECTOR).toBe("platform.kore.dev/retention=Retain");
  expect(DATABASE).toBe("app");
});

test("retained clusters are listed in the namespace with the configured context and the retention selector", async () => {
  const { runner, run } = fakeRunner();
  await retainedClusters(fakeRepository(), runner, "reference");
  expect(commandLines(run)).toEqual([
    'kubectl --context k3d-kore-local --namespace reference get cluster.postgresql.cnpg.io --selector platform.kore.dev/retention=Retain -o jsonpath={range .items[*]}{.metadata.name} {.status.currentPrimary}{"\\n"}{end}',
  ]);
  expect(run.mock.calls[0]?.[2]).toEqual({ capture: true });
});

test("each retained cluster is reported with its current primary, and a cluster with no primary yet has an empty one", async () => {
  const { runner } = fakeRunner(
    () => "pg-main pg-main-1\npg-two\n\n   pg-three   pg-three-2  \n",
  );
  expect(await retainedClusters(fakeRepository(), runner, "reference")).toEqual(
    [
      { name: "pg-main", primary: "pg-main-1" },
      { name: "pg-two", primary: "" },
      { name: "pg-three", primary: "pg-three-2" },
    ],
  );
});

test("no retained clusters is an empty list, not a blank entry", async () => {
  const { runner } = fakeRunner(() => "");
  expect(await retainedClusters(fakeRepository(), runner, "reference")).toEqual(
    [],
  );
});

test("a command in the primary runs through kubectl exec in the configured context and namespace, with no stdin by default", () => {
  expect(
    execArgs(fakeRepository(), "reference", "pg-main-1", { stdin: false }, [
      "pg_dump",
      "--dbname=app",
    ]),
  ).toEqual([
    "--context",
    "k3d-kore-local",
    "--namespace",
    "reference",
    "exec",
    "pg-main-1",
    "--container=postgres",
    "--",
    "pg_dump",
    "--dbname=app",
  ]);
});

test("a command that reads stdin passes -i to kubectl exec, and one that does not never does", () => {
  const withStdin = execArgs(
    fakeRepository(),
    "reference",
    "pg-main-1",
    { stdin: true },
    ["psql"],
  );
  const withoutStdin = execArgs(
    fakeRepository(),
    "reference",
    "pg-main-1",
    { stdin: false },
    ["psql"],
  );
  expect(withStdin.slice(4, 8)).toEqual([
    "exec",
    "-i",
    "pg-main-1",
    "--container=postgres",
  ]);
  expect(withoutStdin).not.toContain("-i");
});
