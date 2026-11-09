import type { Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import type { ImageLockEntry } from "./image-lock.js";
import {
  imageDigestFromRegistryHead,
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
    action({ credential, client }),
  );
}

export async function publishToLocalRegistry(
  repository: Repository,
  runner: Runner,
  entry: ImageLockEntry,
  imageTag: string,
  credential: RegistryCredential,
): Promise<string> {
  const address = await verifiedRegistryAddress(repository, runner);
  const separator = entry.image.indexOf("/");
  if (separator < 1) {
    throw new Error("image repository path is unavailable");
  }
  const repositoryPath = entry.image
    .slice(separator + 1)
    .replace(/:[^/:]+$/, "");
  await withSecretsRedacted([credential.password], () =>
    runner.run(
      "minikube",
      minikubeImagePublishArgs(
        repository.environment.cluster.profile,
        imageTag,
        address,
        `${repositoryPath}:kore-local`,
        credential.username,
      ),
      { capture: true, input: `${credential.password}\n` },
    ),
  );
  return repositoryPath;
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
