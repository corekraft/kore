import { access } from "node:fs/promises";
import { join } from "node:path";
import type { Repository } from "./config.js";
import { assertExpectedCluster } from "./cluster.js";
import { platformStatus } from "./platform.js";
import { imageForApplication, loadImageLock, type LockedImage } from "./image-lock.js";
import { localRegistryReference } from "./registry.js";
import type { Runner } from "./runner.js";

function releaseArgs(
  repository: Repository,
  name: string,
  release: string,
  chart: string,
  image?: LockedImage,
): string[] {
  const args = [
    "upgrade",
    "--install",
    release,
    chart,
    "--namespace",
    name,
    "--create-namespace",
    "--kube-context",
    repository.environment.kubeContext,
    "--wait",
    "--timeout",
    "10m",
    "--rollback-on-failure",
    "--set-string",
    `platform.gateway.name=${repository.environment.gateway.name}`,
    "--set-string",
    `platform.gateway.namespace=${repository.environment.gateway.namespace}`,
    "--set-string",
    `platform.gateway.hostname=${repository.environment.gateway.hostname}`,
    "--set-string",
    `platform.secretStore=${repository.environment.secrets.storeName}`,
    "--set-string",
    `platform.otlpEndpoint=${repository.environment.telemetry.otlpEndpoint}`,
  ];
  if (image) args.push(...imageReleaseArgs(repository, name, image));
  if (image && repository.environment.provider === "minikube") args.push(...localImagePullPolicyArgs());
  return args;
}

export function imageReleaseArgs(
  _repository: Repository,
  _name: string,
  image: LockedImage,
): string[] {
  const separator = image.reference.lastIndexOf("@");
  if (separator < 1) throw new Error("locked image reference must include a digest");
  return [
    "--set-string", `image.repository=${image.reference.slice(0, separator)}`,
    "--set-string", `image.digest=${image.digest}`,
  ];
}

export function localMinikubeImageReference(reference: string, registryClusterIp: string): string {
  const separator = reference.indexOf("/");
  if (separator < 1 || !registryClusterIp.trim()) throw new Error("local image reference and registry ClusterIP are required");
  return `${registryClusterIp}:5000/${reference.slice(separator + 1)}`;
}

export function minikubeImagePullArgs(profile: string, reference: string): string[] {
  return [
    "ssh", "--profile", profile, "--",
    `sudo nerdctl --insecure-registry --namespace k8s.io pull ${reference}`,
  ];
}

export function localImagePullPolicyArgs(): string[] {
  return ["--set-string", "image.pullPolicy=Never"];
}

export function deploymentRolloutStatusArgs(name: string): string[] {
  return ["rollout", "status", `deployment/${name}`, "--timeout=10m"];
}

export function deploymentListArgs(): string[] {
  return ["get", "deployment", "--output=name"];
}

export function verifyLockedImageArgs(image: LockedImage, publicKey?: string): string[] {
  return [
    "verify",
    ...( /:[0-9]+\//.test(image.reference) ? ["--allow-http-registry"] : [] ),
    ...(publicKey ? ["--insecure-ignore-tlog", "--key", publicKey] : ["--certificate-identity", image.signer, "--certificate-oidc-issuer", "https://token.actions.githubusercontent.com"]),
    image.reference,
  ];
}

async function chart(
  repository: Repository,
  name: string,
  kind: "resources" | "workload",
): Promise<string> {
  if (!/^[a-z0-9-]+$/.test(name))
    throw new Error(`invalid application name: ${name}`);
  const path = join(repository.root, "apps", name, "charts", kind);
  await access(join(path, "Chart.yaml"));
  return path;
}

export async function appUp(
  repository: Repository,
  runner: Runner,
  name: string,
  imageOverride?: LockedImage,
  publicKeyOverride?: string,
): Promise<void> {
  await assertExpectedCluster(repository, runner);
  const platform = await platformStatus(repository, runner);
  const unavailable = platform.filter(
    (component) => component.status !== "ready",
  );
  if (unavailable.length) {
    throw new Error(
      `platform is not ready: ${unavailable.map((component) => `${component.name} (${component.detail})`).join(", ")}`,
    );
  }
  const image = imageOverride ?? imageForApplication(await loadImageLock(repository.root), name);
  const verificationImage = { ...image, reference: await localRegistryReference(repository, runner, image.reference) };
  const publicKey = publicKeyOverride ?? (repository.environment.provider === "minikube" && image.signer === "local-kore-key"
    ? join(repository.root, ".kore", "keys", "local", "kore.pub")
    : undefined);
  await runner.run("cosign", verifyLockedImageArgs(verificationImage, publicKey), { capture: false });
  let workloadImage = image;
  if (repository.environment.provider === "minikube") {
    const registry = await runner.run("kubectl", [
      "--context", repository.environment.kubeContext,
      "--namespace", "kore-registry",
      "get", "service", "oci-registry",
      "--output=jsonpath={.spec.clusterIP}",
    ], { capture: true });
    const clusterIp = registry.stdout.trim();
    if (!clusterIp) throw new Error("local OCI registry has no ClusterIP");
    workloadImage = {
      ...image,
      reference: localMinikubeImageReference(image.reference, clusterIp),
    };
    await runner.run("minikube", minikubeImagePullArgs(repository.environment.cluster.profile, workloadImage.reference), { capture: false });
  }
  const resources = await chart(repository, name, "resources"),
    workload = await chart(repository, name, "workload");
  await runner.run(
    "helm",
    releaseArgs(repository, name, `${name}-resources`, resources),
    { capture: false },
  );
  await runner.run(
    "kubectl",
    [
      "--context",
      repository.environment.kubeContext,
      "--namespace",
      name,
      "wait",
      "--for=condition=Ready",
      "postgresqlinstances.platform.kore.dev",
      "--all",
      "--timeout=15m",
    ],
    { capture: false },
  );
  await runner.run(
    "kubectl",
    [
      "--context",
      repository.environment.kubeContext,
      "--namespace",
      name,
      "wait",
      "--for=jsonpath={.data}",
      "secret",
      "--selector",
      `app.kubernetes.io/part-of=${name}`,
      "--timeout=5m",
    ],
    { capture: false },
  );
  await runner.run("helm", releaseArgs(repository, name, name, workload, workloadImage), {
    capture: false,
  });
  const deployments = await runner.run(
    "kubectl",
    [
      "--context",
      repository.environment.kubeContext,
      "--namespace",
      name,
      ...deploymentListArgs(),
    ],
    { capture: true },
  );
  for (const deployment of deployments.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)) {
    const deploymentName = deployment.replace(/^deployment(?:\.apps)?\//, "");
    await runner.run(
      "kubectl",
      ["--context", repository.environment.kubeContext, "--namespace", name, ...deploymentRolloutStatusArgs(deploymentName)],
      { capture: false },
    );
  }
}

export async function appStatus(
  repository: Repository,
  runner: Runner,
  name: string,
): Promise<Record<string, unknown>> {
  await assertExpectedCluster(repository, runner);
  const localImageLockPath = ".kore/state/local-images.lock.json";
  let imageLockPath: string | undefined;
  if (repository.environment.provider === "minikube") {
    try { await access(join(repository.root, localImageLockPath)); imageLockPath = localImageLockPath; }
    catch { /* No local source build has been recorded yet; use the release lock. */ }
  }
  const imageLock = await loadImageLock(repository.root, imageLockPath);
  const image = imageForApplication(imageLock, name);
  const resources = await runner.run(
    "helm",
    [
      "status",
      `${name}-resources`,
      `--namespace=${name}`,
      "--kube-context",
      repository.environment.kubeContext,
      "--output",
      "json",
    ],
    { capture: true },
  );
  const workload = await runner.run(
    "helm",
    [
      "status",
      name,
      `--namespace=${name}`,
      "--kube-context",
      repository.environment.kubeContext,
      "--output",
      "json",
    ],
    { capture: true },
  );
  return {
    name,
    image,
    resources: JSON.parse(resources.stdout),
    workload: JSON.parse(workload.stdout),
  };
}

export async function appDown(
  repository: Repository,
  runner: Runner,
  name: string,
): Promise<void> {
  await assertExpectedCluster(repository, runner);
  await runner.run(
    "helm",
    [
      "uninstall",
      name,
      `--namespace=${name}`,
      "--kube-context",
      repository.environment.kubeContext,
      "--wait",
      "--timeout=10m",
    ],
    { capture: false },
  );
}
