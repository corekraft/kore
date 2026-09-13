import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { absolute, componentValues, componentVersion, expandVersions, orderedComponents, type Component, type Repository } from "./config.js";
import { assertExpectedCluster, ClusterUnavailableError, clusterDestroy, clusterStop, clusterUp } from "./cluster.js";
import type { Runner } from "./runner.js";

function helmTarget(component: Component): string {
  if (component.kind === "local-chart") return component.chart!;
  if (component.repository?.startsWith("oci://")) return component.repository;
  return component.chart!;
}

export function helmUpgradeArgs(repository: Repository, component: Component): string[] {
  const args = ["upgrade", "--install", component.name, helmTarget(component), "--namespace", component.namespace, "--create-namespace", "--kube-context", repository.environment.kubeContext, "--wait", "--timeout", component.timeout, "--rollback-on-failure"];
  if (component.kind === "helm" && component.repository && !component.repository.startsWith("oci://")) args.push("--repo", component.repository);
  const version = componentVersion(repository, component); if (version) args.push("--version", version);
  for (const values of componentValues(repository, component)) args.push("--values", absolute(repository, values));
  return args;
}

export function helmTemplateArgs(repository: Repository, component: Component): string[] {
  const args = ["template", component.name, helmTarget(component), "--namespace", component.namespace, "--include-crds"];
  if (component.kind === "helm" && component.repository && !component.repository.startsWith("oci://")) args.push("--repo", component.repository);
  const version = componentVersion(repository, component); if (version) args.push("--version", version);
  for (const values of componentValues(repository, component)) args.push("--values", absolute(repository, values));
  return args;
}

async function waitFor(repository: Repository, runner: Runner, component: Component): Promise<void> {
  const base = ["--context", repository.environment.kubeContext, "--namespace", component.namespace];
  for (const resource of component.readiness) {
    if (resource.startsWith("crd/")) await runner.run("kubectl", ["--context", repository.environment.kubeContext, "wait", "--for=condition=Established", resource, `--timeout=${component.timeout}`], { capture:false });
    else if (resource.startsWith("gateway/")) await runner.run("kubectl", [...base, "wait", "--for=condition=Programmed", resource, `--timeout=${component.timeout}`], { capture:false });
    else await runner.run("kubectl", [...base, "rollout", "status", resource, `--timeout=${component.timeout}`], { capture:false });
  }
  for (const crd of component.ownsCRDs) await runner.run("kubectl", ["--context",repository.environment.kubeContext,"wait","--for=condition=Established",`crd/${crd}`,`--timeout=${component.timeout}`], { capture:false });
}

export async function reconcileComponent(repository: Repository, runner: Runner, component: Component): Promise<void> {
  try {
    if (component.kind === "manifest") {
      const expanded = expandVersions(repository, component.source!);
      const source = /^https?:\/\//.test(expanded) ? expanded : absolute(repository, expanded);
      await runner.run("kubectl", ["--context", repository.environment.kubeContext, "apply", "--server-side", "--field-manager=kore", "--recursive", "--filename", source], { capture:false });
    } else await runner.run("helm", helmUpgradeArgs(repository, component).map((value) => component.kind === "local-chart" && value === component.chart ? absolute(repository, value) : value), { capture:false, cwd:repository.root });
    await waitFor(repository, runner, component);
  } catch (error) { throw new Error(`component ${component.name} failed to become ready: ${error instanceof Error ? error.message : String(error)}`); }
}

export async function platformUp(repository: Repository, runner: Runner): Promise<void> {
  if (repository.environment.provider === "minikube") {
    try { await assertExpectedCluster(repository, runner); }
    catch (error) {
      if (!(error instanceof ClusterUnavailableError)) throw error;
      await clusterUp(repository, runner);
    }
  } else await assertExpectedCluster(repository, runner);
  for (const component of orderedComponents(repository.catalog)) await reconcileComponent(repository, runner, component);
  await writePlatformState(repository, "ready");
}

async function writePlatformState(repository: Repository, status: string): Promise<void> {
  const directory = join(repository.root, ".kore", "state"); await mkdir(directory, { recursive:true });
  await writeFile(join(directory, `${repository.environment.name}.json`), JSON.stringify({ environment:repository.environment.name, context:repository.environment.kubeContext, status, reconciledAt:new Date().toISOString() }, null, 2));
}

export interface ComponentStatus { name: string; namespace: string; status: "ready" | "missing" | "degraded"; detail: string }
export async function platformStatus(repository: Repository, runner: Runner): Promise<ComponentStatus[]> {
  const result: ComponentStatus[] = [];
  for (const component of orderedComponents(repository.catalog)) {
    try {
      if (component.kind === "manifest") {
        for (const crd of component.ownsCRDs) await runner.run("kubectl", ["--context",repository.environment.kubeContext,"get",`crd/${crd}`,"-o","name"], { capture:true });
      } else await runner.run("helm", ["status",component.name,"--namespace",component.namespace,"--kube-context",repository.environment.kubeContext,"--output","json"], { capture:true });
      result.push({ name:component.name,namespace:component.namespace,status:"ready",detail:"installed" });
    } catch (error) { result.push({ name:component.name,namespace:component.namespace,status:"missing",detail:error instanceof Error ? error.message : String(error) }); }
  }
  return result;
}

export async function platformRender(repository: Repository, runner: Runner, outputDirectory?: string): Promise<void> {
  const target = outputDirectory ? absolute(repository, outputDirectory) : undefined;
  if (target) await mkdir(target, { recursive:true });
  for (const component of orderedComponents(repository.catalog)) {
    if (component.kind === "manifest") continue;
    const result = await runner.run("helm", helmTemplateArgs(repository, component).map((value) => component.kind === "local-chart" && value === component.chart ? absolute(repository, value) : value), { capture:true, cwd:repository.root });
    if (target) await writeFile(join(target, `${component.name}.yaml`), result.stdout, { mode:0o600 });
    await runner.run("kubectl", ["apply", "--dry-run=client", "--validate=false", "--filename", "-"], { capture:true, input:result.stdout });
  }
}

export async function platformStop(repository: Repository, runner: Runner): Promise<void> { await clusterStop(repository, runner); }
export async function platformDestroy(repository: Repository, runner: Runner, options: { yes:boolean; purgeData:boolean }): Promise<void> { await clusterDestroy(repository, runner, options); }

export async function hasVerifiedExport(repository: Repository): Promise<boolean> {
  const directory = join(repository.root, ".kore", "exports", repository.environment.name);
  try {
    for (const entry of await readdir(directory)) {
      if (!entry.endsWith(".sha256")) continue;
      const checksum = (await readFile(join(directory, entry), "utf8")).trim();
      if (/^[a-f0-9]{64}$/.test(checksum)) return true;
    }
  } catch { return false; }
  return false;
}
