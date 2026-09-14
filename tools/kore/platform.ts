import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { absolute, componentValues, componentVersion, expandVersions, orderedComponents, type Component, type Repository } from "./config.js";
import { assertExpectedCluster, ClusterUnavailableError, clusterDestroy, clusterStop, clusterUp, hasVerifiedExport } from "./cluster.js";
import type { Runner } from "./runner.js";
import { startLocalTunnel, stopLocalTunnel, type TunnelDependencies } from "./tunnel.js";
import { installLocalTrust } from "./trust.js";

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
    if (resource.startsWith("crd/")) await waitForCRD(repository, runner, resource, component.timeout);
    else if (resource.startsWith("gateway/")) await runner.run("kubectl", [...base, "wait", "--for=condition=Programmed", resource, `--timeout=${component.timeout}`], { capture:false });
    else await runner.run("kubectl", [...base, "rollout", "status", resource, `--timeout=${component.timeout}`], { capture:false });
  }
  for (const crd of component.ownsCRDs) await waitForCRD(repository, runner, `crd/${crd}`, component.timeout);
}

function timeoutMilliseconds(value: string): number {
  const match = value.match(/^(\d+)([smh])$/);
  if (!match) return 10 * 60 * 1000;
  const amount = Number(match[1]);
  return amount * (match[2] === "h" ? 3600000 : match[2] === "m" ? 60000 : 1000);
}

async function waitForCRD(repository: Repository, runner: Runner, resource: string, timeout: string): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds(timeout);
  while (true) {
    try {
      await runner.run("kubectl", ["--context", repository.environment.kubeContext, "wait", "--for=condition=Established", resource, `--timeout=${timeout}`], { capture:true });
      return;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (!/not found|no matches for kind|the server doesn't have a resource type/i.test(detail) || Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
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

function deployed(status: string): boolean {
  const parsed = JSON.parse(status) as { info?: { status?: string | { status?: string } } };
  const value = typeof parsed.info?.status === "string" ? parsed.info.status : parsed.info?.status?.status;
  return value === "deployed";
}

async function componentIsInstalled(repository: Repository, runner: Runner, component: Component): Promise<boolean> {
  try {
    if (component.kind === "manifest") {
      if (!component.ownsCRDs.length) return false;
      for (const crd of component.ownsCRDs) {
        await runner.run("kubectl", ["--context", repository.environment.kubeContext, "get", `crd/${crd}`, "-o", "name"], { capture: true });
      }
      return true;
    }
    const release = await runner.run("helm", ["status", component.name, "--namespace", component.namespace, "--kube-context", repository.environment.kubeContext, "--output", "json"], { capture: true });
    return deployed(release.stdout);
  } catch {
    return false;
  }
}

async function reconcileIfNeeded(repository: Repository, runner: Runner, component: Component): Promise<void> {
  if (await componentIsInstalled(repository, runner, component)) {
    await waitFor(repository, runner, component);
    return;
  }
  await reconcileComponent(repository, runner, component);
}

async function ensureCluster(repository: Repository, runner: Runner): Promise<void> {
  if (repository.environment.provider === "minikube") {
    try { await assertExpectedCluster(repository, runner); }
    catch (error) {
      if (!(error instanceof ClusterUnavailableError)) throw error;
      await clusterUp(repository, runner);
    }
  } else await assertExpectedCluster(repository, runner);
}

export async function bootstrapControllers(repository: Repository, runner: Runner): Promise<void> {
  await ensureCluster(repository, runner);
  for (const component of orderedComponents(repository.catalog)) {
    if (component.phase === "configuration" || component.phase === "enforcement") continue;
    await reconcileIfNeeded(repository, runner, component);
  }
}

export async function platformUp(repository: Repository, runner: Runner, tunnelDependencies: TunnelDependencies = {}): Promise<void> {
  await bootstrapControllers(repository, runner);
  if (repository.environment.provider === "minikube") await installLocalTrust(repository, runner);
  if (repository.environment.provider === "minikube") await startLocalTunnel(repository, runner, tunnelDependencies);
  for (const component of orderedComponents(repository.catalog)) {
    if (component.phase !== "configuration" && component.phase !== "enforcement") continue;
    await reconcileIfNeeded(repository, runner, component);
  }
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
      } else {
        const release = await runner.run("helm", ["status",component.name,"--namespace",component.namespace,"--kube-context",repository.environment.kubeContext,"--output","json"], { capture:true });
        const parsed = JSON.parse(release.stdout) as { info?: { status?: string | { status?: string } } };
        const releaseStatus = typeof parsed.info?.status === "string" ? parsed.info.status : parsed.info?.status?.status;
        if (releaseStatus && releaseStatus !== "deployed") {
          result.push({ name:component.name,namespace:component.namespace,status:"degraded",detail:`Helm release status is ${releaseStatus}` });
          continue;
        }
      }
      result.push({ name:component.name,namespace:component.namespace,status:"ready",detail:"installed" });
    } catch (error) { result.push({ name:component.name,namespace:component.namespace,status:"missing",detail:error instanceof Error ? error.message : String(error) }); }
  }
  return result;
}

export async function platformRender(repository: Repository, runner: Runner, outputDirectory?: string): Promise<void> {
  const target = outputDirectory ? absolute(repository, outputDirectory) : undefined;
  if (target) await mkdir(target, { recursive:true });
  for (const component of orderedComponents(repository.catalog)) {
    if (component.kind === "manifest") {
      const expanded = expandVersions(repository, component.source!);
      const source = /^https?:\/\//.test(expanded) ? expanded : absolute(repository, expanded);
      await runner.run("kubectl", ["apply", "--dry-run=client", "--validate=false", "--recursive", "--filename", source], { capture:true, cwd:repository.root });
      continue;
    }
    const result = await runner.run("helm", helmTemplateArgs(repository, component).map((value) => component.kind === "local-chart" && value === component.chart ? absolute(repository, value) : value), { capture:true, cwd:repository.root });
    if (target) await writeFile(join(target, `${component.name}.yaml`), result.stdout, { mode:0o600 });
    await runner.run("kubectl", ["apply", "--dry-run=client", "--validate=false", "--filename", "-"], { capture:true, input:result.stdout });
  }
}

export async function platformStop(repository: Repository, runner: Runner): Promise<void> {
  if (repository.environment.provider === "minikube") await stopLocalTunnel(repository, runner);
  await clusterStop(repository, runner);
}
export async function platformDestroy(repository: Repository, runner: Runner, options: { yes:boolean; purgeData:boolean }): Promise<void> {
  if (repository.environment.provider === "minikube") await stopLocalTunnel(repository, runner);
  await clusterDestroy(repository, runner, options);
}
