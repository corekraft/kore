import type { Repository } from "../config/index.js";
import { minikubeCluster } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import type { ImageLockEntry } from "./image-lock.js";
import {
  imageDigestFromRegistryHead,
  k3dImagePublishArgs,
  minikubeImagePublishArgs,
} from "./local-image-args.js";
import {
  loadRegistryCredential,
  withSecretsRedacted,
  type RegistryCredential,
} from "./registry-auth.js";
import { loadRegistryCa } from "./registry-tls.js";
import { withRegistryClient, type RegistryClient } from "./registry-client.js";
import { verifiedRegistryAddress } from "./registry-service.js";

// Docs: docs/decisions/0034-registry-authentication-and-authorization.md

const manifestAccept =
  "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json";

export interface PublishSession {
  credential: RegistryCredential;
  ca: string;
  client: RegistryClient;
}

/** Runs the publish path with kore's push credential and nothing else's. */
export async function withPublishSession<T>(
  repository: Repository,
  runner: Runner,
  action: (session: PublishSession) => Promise<T>,
): Promise<T> {
  const credential = await loadRegistryCredential(repository, runner, "push");
  const ca = await loadRegistryCa(repository, runner);
  return await withRegistryClient(credential, ca, (client) =>
    action({ credential, ca, client }),
  );
}

/**
 * Pushes the image `copy.tag` (already in the cluster's nodes) to
 * `<address>/<copy.target>` with the push identity, by the provider's
 * transport: the node's containerd client on k3d (ADR 0083), nerdctl over
 * Minikube's ssh otherwise (ADR 0034).
 */
export async function publishImageCopy(
  repository: Repository,
  runner: Runner,
  copy: { tag: string; address: string; target: string },
  { credential, ca }: Pick<PublishSession, "credential" | "ca">,
): Promise<void> {
  if (!/^[a-z][a-z0-9-]*$/.test(credential.username)) {
    throw new Error(
      `local registry has an invalid username; the push identity must be lowercase letters, digits and hyphens`,
    );
  }
  if (repository.environment.provider === "k3d") {
    const { k3d } = repository.environment;
    if (k3d === undefined) {
      throw new Error(
        `environment ${repository.environment.name} is a k3d overlay without environment.k3d settings; add environment.k3d.clusterName so the image can be published`,
      );
    }
    // The node reads base64(user:password) from stdin for its Basic header.
    const basic = Buffer.from(
      `${credential.username}:${credential.password}`,
    ).toString("base64");
    await withSecretsRedacted([credential.password, basic], () =>
      runner.run(
        "docker",
        k3dImagePublishArgs(
          k3d.clusterName,
          copy.tag,
          copy.address,
          copy.target,
          ca,
        ),
        { capture: true, input: `${basic}\n` },
      ),
    );
    return;
  }
  await withSecretsRedacted([credential.password], () =>
    runner.run(
      "minikube",
      minikubeImagePublishArgs(
        minikubeCluster(repository.environment).profile,
        copy.tag,
        copy.address,
        copy.target,
        credential.username,
      ),
      { capture: true, input: `${credential.password}\n` },
    ),
  );
}

export async function publishToLocalRegistry(
  repository: Repository,
  runner: Runner,
  entry: ImageLockEntry,
  imageTag: string,
  session: Pick<PublishSession, "credential" | "ca">,
): Promise<{ address: string; repositoryPath: string }> {
  const address = await verifiedRegistryAddress(repository, runner);
  const separator = entry.image.indexOf("/");
  if (separator < 1) {
    throw new Error("image repository path is unavailable");
  }
  const repositoryPath = entry.image
    .slice(separator + 1)
    .replace(/:[^/:]+$/, "");
  await publishImageCopy(
    repository,
    runner,
    { tag: imageTag, address, target: `${repositoryPath}:kore-local` },
    session,
  );
  return { address, repositoryPath };
}

export async function publishedDigest(
  repositoryPath: string,
  client: Pick<RegistryClient, "authorization" | "head">,
): Promise<string> {
  const manifestPath = repositoryPath
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  const manifest = await client.head(
    `https://127.0.0.1:30500/v2/${manifestPath}/manifests/kore-local`,
    { Accept: manifestAccept, Authorization: client.authorization },
  );
  return imageDigestFromRegistryHead(
    manifest.status,
    `docker-content-digest: ${manifest.digest}`,
  );
}
