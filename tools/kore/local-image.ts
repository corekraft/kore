import { access, chmod, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ImageLockEntry, LockedImage } from "./image-lock.js";
import type { Repository } from "./config.js";
import { localRegistryReference } from "./registry.js";
import type { Runner } from "./runner.js";

export interface BuiltLocalImage {
  image: LockedImage;
  publicKey: string;
}

export function localDockerBuildArgs(
  applicationPath: string,
  tag: string,
): string[] {
  return [
    "build",
    "--file",
    join(applicationPath, "Dockerfile"),
    "--tag",
    tag,
    applicationPath,
  ];
}

export function minikubeImageLoadArgs(profile: string, tag: string): string[] {
  return ["image", "load", "--profile", profile, "--daemon", tag];
}

export function minikubeImagePublishArgs(
  profile: string,
  tag: string,
  clusterIp: string,
  repositoryPath: string,
): string[] {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(clusterIp))
    throw new Error("local registry has an invalid ClusterIP");
  const destination = `${clusterIp}:5000/${repositoryPath}`;
  return [
    "ssh",
    "--profile",
    profile,
    "--",
    `sudo nerdctl --namespace k8s.io tag '${tag}' '${destination}' && sudo nerdctl --insecure-registry --namespace k8s.io push '${destination}'`,
  ];
}

export function imageDigestFromRegistryHead(
  status: number,
  headers: string,
): string {
  if (status !== 200)
    throw new Error(
      `local registry manifest lookup failed with HTTP ${status}`,
    );
  const digests = [
    ...new Set(
      [
        ...headers.matchAll(
          /^docker-content-digest:\s*(sha256:[a-f0-9]{64})\s*$/gim,
        ),
      ].map((match) => match[1]),
    ),
  ];
  if (digests.length !== 1 || !digests[0])
    throw new Error(
      "local registry response did not include one valid manifest digest",
    );
  return digests[0];
}

export function localSigningConfigArgs(path: string): string[] {
  return [
    "signing-config",
    "create",
    "--with-default-services",
    "--no-default-rekor",
    "--no-default-tsa",
    "--out",
    path,
  ];
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function ensureLocalSigner(
  repository: Repository,
  runner: Runner,
): Promise<{ key: string; publicKey: string; signingConfig: string }> {
  const directory = join(repository.root, ".kore", "keys", "local");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const prefix = join(directory, "automation");
  const key = `${prefix}.key`,
    publicKey = `${prefix}.pub`,
    signingConfig = join(
      repository.root,
      ".kore",
      "state",
      "local-signing-config.json",
    );
  const hasKey = await exists(key),
    hasPublicKey = await exists(publicKey);
  if (hasKey !== hasPublicKey)
    throw new Error(
      `local signing key pair is incomplete: expected ${key} and ${publicKey}`,
    );
  if (!hasKey) {
    await runner.run(
      "cosign",
      ["generate-key-pair", "--output-key-prefix", prefix],
      {
        capture: false,
        env: { ...process.env, COSIGN_PASSWORD: "" },
      },
    );
    await chmod(key, 0o600);
    await chmod(publicKey, 0o644);
  }
  if (!(await exists(signingConfig))) {
    await mkdir(dirname(signingConfig), { recursive: true });
    await runner.run("cosign", localSigningConfigArgs(signingConfig), {
      capture: false,
    });
  }
  return { key, publicKey, signingConfig };
}

export async function buildAndSignLocalImage(
  repository: Repository,
  runner: Runner,
  application: string,
  entry: ImageLockEntry,
): Promise<BuiltLocalImage> {
  const signer = await ensureLocalSigner(repository, runner);
  const applicationPath = join(repository.root, "apps", application);
  const imageTag = `kore-local/${application}:kore-local`;
  await localRegistryReference(repository, runner, `${entry.image}:kore-local`);
  await runner.run("docker", localDockerBuildArgs(applicationPath, imageTag), {
    capture: false,
    cwd: repository.root,
  });
  await runner.run(
    "minikube",
    minikubeImageLoadArgs(repository.environment.cluster.profile, imageTag),
    { capture: false },
  );
  const registry = await runner.run(
    "kubectl",
    [
      "--context",
      repository.environment.kubeContext,
      "--namespace",
      "kore-registry",
      "get",
      "service",
      "oci-registry",
      "--output=jsonpath={.spec.clusterIP}",
    ],
    { capture: true },
  );
  const clusterIp = registry.stdout.trim();
  const separator = entry.image.indexOf("/");
  if (separator < 1 || !clusterIp)
    throw new Error(
      "local registry service or image repository path is unavailable",
    );
  const repositoryPath = entry.image
    .slice(separator + 1)
    .replace(/:[^/:]+$/, "");
  await runner.run(
    "minikube",
    minikubeImagePublishArgs(
      repository.environment.cluster.profile,
      imageTag,
      clusterIp,
      `${repositoryPath}:kore-local`,
    ),
    { capture: true },
  );
  const manifestPath = repositoryPath
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  const manifest = await fetch(
    `http://127.0.0.1:30500/v2/${manifestPath}/manifests/kore-local`,
    {
      method: "HEAD",
      headers: {
        Accept:
          "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json",
      },
    },
  );
  const digest = imageDigestFromRegistryHead(
    manifest.status,
    `docker-content-digest: ${manifest.headers.get("docker-content-digest") ?? ""}`,
  );
  const image: LockedImage = {
    reference: `${entry.image}@${digest}`,
    digest,
    signer: "local-kore-key",
  };
  const signingReference = await localRegistryReference(
    repository,
    runner,
    image.reference,
  );
  await runner.run(
    "cosign",
    [
      "sign",
      "--key",
      signer.key,
      "--signing-config",
      signer.signingConfig,
      "--allow-http-registry",
      "--yes",
      signingReference,
    ],
    { capture: false, env: { ...process.env, COSIGN_PASSWORD: "" } },
  );
  return { image, publicKey: signer.publicKey };
}
