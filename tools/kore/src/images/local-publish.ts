import type { Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import type { ImageLockEntry } from "./image-lock.js";
import {
  imageDigestFromRegistryHead,
  k3dImagePublishArgs,
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

/**
 * The k3d settings a local image operation needs. A provider other than k3d is
 * refused with the move to k3d; a k3d overlay without settings is told which
 * setting to add.
 */
export function requireK3d(
  repository: Repository,
): NonNullable<Repository["environment"]["k3d"]> {
  const { provider, k3d, name } = repository.environment;
  if (provider !== "k3d") {
    throw new Error(
      `provider ${provider} is no longer a local provider; set environment.provider to k3d and add environment.k3d (ADR 0076)`,
    );
  }
  if (k3d === undefined) {
    throw new Error(
      `environment ${name} is a k3d overlay without environment.k3d settings; add environment.k3d.clusterName`,
    );
  }
  return k3d;
}

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
  requireK3d(repository); // fail fast, before any command runs
  const credential = await loadRegistryCredential(repository, runner, "push");
  const ca = await loadRegistryCa(repository, runner);
  return await withRegistryClient(credential, ca, (client) =>
    action({ credential, ca, client }),
  );
}

/**
 * Pushes the image `copy.tag` (already in the cluster's nodes) to
 * `<address>/<copy.target>` with the push identity, by the provider's
 * transport: the node's containerd client through docker exec (ADR 0083).
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
  const k3d = requireK3d(repository);
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
