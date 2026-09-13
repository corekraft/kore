import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { clusterDestroy, clusterStartArgs, clusterStop } from "./cluster.js";
import { loadRepository } from "./config.js";
import { RecordingRunner } from "./runner.js";

test("cluster start command pins profile, context inputs, runtime, and resources", async () => {
  const repository = await loadRepository("local"); const args = clusterStartArgs(repository.environment);
  assert.deepEqual(args,["start","--profile","kore-local","--kubernetes-version","v1.35.1","--driver","docker","--container-runtime","containerd","--cpus","4","--memory","8192","--disk-size","40g","--keep-context=false"]);
});

test("destroy requires explicit confirmation", async () => {
  const repository = await loadRepository("local");
  const runner = new RecordingRunner([
    {stdout:"{}",stderr:"",code:0},{stdout:"kube-system",stderr:"",code:0},
    {stdout:"",stderr:"",code:0},{stdout:"",stderr:"",code:0},
  ]);
  await assert.rejects(clusterDestroy(repository,runner,{yes:false,purgeData:false}),/requires --yes/);
  assert.equal(runner.calls.some((call) => call.args.includes("delete")),false);
});

test("cluster stop uses flags supported by Minikube", async () => {
  const repository = await loadRepository("local");
  const runner = new RecordingRunner([
    {stdout:"{}",stderr:"",code:0},
    {stdout:"kube-system",stderr:"",code:0},
  ]);

  await clusterStop(repository, runner);

  assert.equal(runner.calls.at(-1)?.command, "minikube");
  assert.deepEqual(runner.calls.at(-1)?.args, ["stop", "--profile", "kore-local"]);
});

test("retained data blocks cluster deletion", async () => {
  const repository = await loadRepository("local");
  const runner = new RecordingRunner([
    {stdout:"{}",stderr:"",code:0},{stdout:"kube-system",stderr:"",code:0},
    {stdout:"postgresqlinstance.platform.kore.dev/reference-db\n",stderr:"",code:0},{stdout:"",stderr:"",code:0},
  ]);
  await assert.rejects(clusterDestroy(repository,runner,{yes:true,purgeData:false}),/destroy blocked by retained data/);
  assert.equal(runner.calls.some((call) => call.args.includes("delete")),false);
});

test("purging retained data explicitly deletes retained claims before the profile", async () => {
  const repository = await loadRepository("local");
  const runner = new RecordingRunner([
    {stdout:"{}",stderr:"",code:0},
    {stdout:"kube-system",stderr:"",code:0},
    {stdout:"postgresqlinstance.platform.kore.dev/reference-db\n",stderr:"",code:0},
    {stdout:"persistentvolumeclaim/reference-db-1\n",stderr:"",code:0},
  ]);

  await clusterDestroy(repository,runner,{yes:true,purgeData:true});
  const deleteCalls = runner.calls.filter(({command,args}) => command === "kubectl" && args.includes("delete"));
  assert.equal(deleteCalls.length,2);
  assert.ok(deleteCalls.every(({args}) => args.includes("--all-namespaces") && args.includes("--ignore-not-found")));
  assert.equal(runner.calls.at(-1)?.command,"minikube");
  assert.equal(runner.calls.at(-1)?.args[0],"delete");
});

test("verified exports allow destroying an unreachable profile without purging data", async () => {
  const repository = await loadRepository("local");
  const exportDirectory = join(repository.root, ".kore", "exports", repository.environment.name);
  await mkdir(exportDirectory, { recursive: true });
  const exportFile = join(exportDirectory, "reference.sql");
  const exportContents = "CREATE TABLE reference (id integer);\n";
  await writeFile(exportFile, exportContents);
  const checksum = join(exportDirectory, "reference.sql.sha256");
  await writeFile(checksum, `${createHash("sha256").update(exportContents).digest("hex")}  reference.sql\n`);
  const runner = new RecordingRunner();
  try {
    await clusterDestroy(repository, runner, { yes: true, purgeData: false });
  } finally {
    await rm(join(repository.root, ".kore"), { recursive: true, force: true });
  }
  assert.equal(runner.calls.at(-1)?.args[0], "delete");
});
