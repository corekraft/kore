import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ImageLockEntry, LockedImage } from "./image-lock.js";
import type { Repository } from "../config/index.js";
import { localRegistryReference } from "./registry.js";
import type { Runner } from "../runtime/index.js";

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

export const localSigningKeyNamespace = "kore-system";
export const localSigningKeySecret = "kore-local-signing-key";
const localSigningKeyReference = `k8s://${localSigningKeyNamespace}/${localSigningKeySecret}`;

function secretArgs(kubeContext: string, ...rest: string[]): string[] {
  return [
    "--context",
    kubeContext,
    "--namespace",
    localSigningKeyNamespace,
    "get",
    "secret",
    localSigningKeySecret,
    ...rest,
  ];
}

interface LocalSigner {
  key: string;
  publicKey: string;
  signingConfig: string;
  env: NodeJS.ProcessEnv;
}

// Cosign resolves k8s:// references through the kubeconfig's current context,
// so the configured context is pinned with a minified, credential-free
// kubeconfig that only lives for the duration of the signing call.
async function withLocalSigner<T>(
  repository: Repository,
  runner: Runner,
  action: (signer: LocalSigner) => Promise<T>,
): Promise<T> {
  const kubeContext = repository.environment.kubeContext;
  const state = join(repository.root, ".kore", "state");
  const legacy = join(repository.root, ".kore", "keys", "local");
  if (await exists(legacy))
    process.stderr.write(
      `legacy local signing key under ${legacy} is no longer used and can be deleted; the key now lives in the ${localSigningKeyNamespace}/${localSigningKeySecret} Secret for the cluster's lifetime\n`,
    );
  const kubeconfig = (
    await runner.run(
      "kubectl",
      ["config", "view", "--minify", "--context", kubeContext],
      { capture: true },
    )
  ).stdout;
  if (/(?:-data|token|password)\s*:/.test(kubeconfig))
    throw new Error(
      `kubeconfig context ${kubeContext} embeds credentials; reference certificate files instead so they are never copied to disk`,
    );
  const directory = await mkdtemp(join(tmpdir(), "kore-kubeconfig-"));
  try {
    const kubeconfigPath = join(directory, "config");
    await writeFile(kubeconfigPath, kubeconfig, { mode: 0o600 });
    const env = {
      ...process.env,
      KUBECONFIG: kubeconfigPath,
      COSIGN_PASSWORD: "",
    };
    const present = await runner.run(
      "kubectl",
      secretArgs(kubeContext, "--ignore-not-found", "--output=name"),
      { capture: true },
    );
    if (!present.stdout.trim())
      await runner.run(
        "cosign",
        ["generate-key-pair", localSigningKeyReference],
        { capture: false, env },
      );
    const encoded = await runner.run(
      "kubectl",
      secretArgs(kubeContext, "--output=jsonpath={.data.cosign\\.pub}"),
      { capture: true },
    );
    const publicKey = join(state, "local-signing.pub");
    const signingConfig = join(state, "local-signing-config.json");
    await mkdir(state, { recursive: true });
    await writeFile(
      publicKey,
      Buffer.from(encoded.stdout.trim(), "base64").toString("utf8"),
    );
    if (!(await exists(signingConfig)))
      await runner.run("cosign", localSigningConfigArgs(signingConfig), {
        capture: false,
      });
    return await action({
      key: localSigningKeyReference,
      publicKey,
      signingConfig,
      env,
    });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

export async function buildAndSignLocalImage(
  repository: Repository,
  runner: Runner,
  application: string,
  entry: ImageLockEntry,
): Promise<BuiltLocalImage> {
  return await withLocalSigner(repository, runner, (signer) =>
    buildAndSign(repository, runner, application, entry, signer),
  );
}

async function buildAndSign(
  repository: Repository,
  runner: Runner,
  application: string,
  entry: ImageLockEntry,
  signer: LocalSigner,
): Promise<BuiltLocalImage> {
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
    { capture: false, env: signer.env },
  );
  return { image, publicKey: signer.publicKey };
}
