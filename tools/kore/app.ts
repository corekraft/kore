import { access } from "node:fs/promises";
import { join } from "node:path";
import type { Repository } from "./config.js";
import { assertExpectedCluster } from "./cluster.js";
import { platformStatus } from "./platform.js";
import type { Runner } from "./runner.js";

function releaseArgs(repository: Repository, name: string, release: string, chart: string): string[] {
  return ["upgrade","--install",release,chart,"--namespace",name,"--create-namespace","--kube-context",repository.environment.kubeContext,"--wait","--timeout","10m","--atomic=false",
    "--set-string",`platform.gateway.name=${repository.environment.gateway.name}`,
    "--set-string",`platform.gateway.namespace=${repository.environment.gateway.namespace}`,
    "--set-string",`platform.gateway.hostname=${repository.environment.gateway.hostname}`,
    "--set-string",`platform.secretStore=${repository.environment.secrets.storeName}`,
    "--set-string",`platform.otlpEndpoint=${repository.environment.telemetry.otlpEndpoint}`,
  ];
}

async function chart(repository: Repository, name: string, kind: "resources"|"workload"): Promise<string> {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`invalid application name: ${name}`);
  const path = join(repository.root,"apps",name,"charts",kind); await access(join(path,"Chart.yaml")); return path;
}

export async function appUp(repository: Repository, runner: Runner, name: string): Promise<void> {
  await assertExpectedCluster(repository, runner);
  const platform = await platformStatus(repository, runner);
  const unavailable = platform.filter((component) => component.status !== "ready");
  if (unavailable.length) {
    throw new Error(`platform is not ready: ${unavailable.map((component) => `${component.name} (${component.detail})`).join(", ")}`);
  }
  const resources = await chart(repository,name,"resources"), workload = await chart(repository,name,"workload");
  await runner.run("helm",releaseArgs(repository,name,`${name}-resources`,resources),{capture:false});
  await runner.run("kubectl",["--context",repository.environment.kubeContext,"--namespace",name,"wait","--for=condition=Ready","postgresqlinstances.platform.kore.dev","--all","--timeout=15m"],{capture:false});
  await runner.run("kubectl",["--context",repository.environment.kubeContext,"--namespace",name,"wait","--for=jsonpath={.data}","secret","--selector",`app.kubernetes.io/part-of=${name}`,"--timeout=5m"],{capture:false});
  if (repository.environment.provider === "minikube") {
    const image = repository.versions.images[name] ?? repository.versions.images.reference;
    if (image) await runner.run("minikube",["image","load",image,"--profile",repository.environment.cluster.profile],{capture:false});
  }
  await runner.run("helm",releaseArgs(repository,name,name,workload),{capture:false});
  await runner.run("kubectl",["--context",repository.environment.kubeContext,"--namespace",name,"rollout","status","deployment","--all","--timeout=10m"],{capture:false});
}

export async function appStatus(repository: Repository, runner: Runner, name: string): Promise<Record<string,unknown>> {
  await assertExpectedCluster(repository,runner);
  const resources = await runner.run("helm",["status",`${name}-resources`,`--namespace=${name}`,"--kube-context",repository.environment.kubeContext,"--output","json"],{capture:true});
  const workload = await runner.run("helm",["status",name,`--namespace=${name}`,"--kube-context",repository.environment.kubeContext,"--output","json"],{capture:true});
  return { name, resources:JSON.parse(resources.stdout), workload:JSON.parse(workload.stdout) };
}

export async function appDown(repository: Repository, runner: Runner, name: string): Promise<void> {
  await assertExpectedCluster(repository,runner);
  await runner.run("helm",["uninstall",name,`--namespace=${name}`,"--kube-context",repository.environment.kubeContext,"--wait","--timeout=10m"],{capture:false});
}
