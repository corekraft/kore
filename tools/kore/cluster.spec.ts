import assert from "node:assert/strict";
import { test } from "vitest";
import { clusterDestroy, clusterStartArgs } from "./cluster.js";
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
