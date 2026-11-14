import { RegistryPruneError } from "./registry-prune-error.js";
import type { RegistryAdmin } from "./registry-prune.js";
import { registryRequest, type RegistryResponse } from "./registry-https.js";

// Docs: docs/decisions/0094-worktrees-sharing-a-cluster-share-its-locks-tags-and-forward.md

const base = "https://127.0.0.1:30500/v2";
const accept =
  "application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json";

export interface RegistryAdminTransport {
  /** The verified HTTPS transport unless a test supplies its own. */
  request?: (
    method: string,
    url: string,
    headers: Record<string, string>,
    ca: string,
  ) => Promise<RegistryResponse>;
  authorization: string;
  ca: string;
}

const path = (repository: string): string =>
  repository.split("/").map(encodeURIComponent).join("/");

/** The registry operations pruning needs, over the verified HTTPS transport. */
export function createRegistryAdmin(
  transport: RegistryAdminTransport,
): RegistryAdmin {
  const send = async (
    method: string,
    url: string,
    expected: number,
  ): Promise<RegistryResponse> => {
    const response = await (transport.request ?? registryRequest)(
      method,
      url,
      { Accept: accept, Authorization: transport.authorization },
      transport.ca,
    );
    if (response.status !== expected) {
      throw new RegistryPruneError(
        `registry answered ${response.status} for ${method} ${url}; expected ${expected}`,
      );
    }
    return response;
  };
  const json = async (url: string): Promise<Record<string, unknown>> =>
    JSON.parse((await send("GET", url, 200)).body) as Record<string, unknown>;

  return {
    repositories: async () =>
      ((await json(`${base}/_catalog`))["repositories"] ?? []) as string[],
    tags: async (repository) =>
      ((await json(`${base}/${path(repository)}/tags/list`))["tags"] ??
        []) as string[],
    digest: async (repository, tag) =>
      (await send("HEAD", `${base}/${path(repository)}/manifests/${tag}`, 200))
        .headers["docker-content-digest"] ?? "",
    created: async (repository, tag) => {
      const manifest = await json(
        `${base}/${path(repository)}/manifests/${tag}`,
      );
      const config = (manifest["config"] as { digest?: string } | undefined)
        ?.digest;
      if (config === undefined) {
        return Infinity;
      }
      const built = (await json(`${base}/${path(repository)}/blobs/${config}`))[
        "created"
      ];
      return typeof built === "string" && !Number.isNaN(Date.parse(built))
        ? Date.parse(built)
        : Infinity;
    },
    remove: async (repository, digest) => {
      const response = await (transport.request ?? registryRequest)(
        "DELETE",
        `${base}/${path(repository)}/manifests/${digest}`,
        { Authorization: transport.authorization },
        transport.ca,
      );
      if (response.status !== 202) {
        throw new RegistryPruneError(
          `registry answered ${response.status} deleting ${repository}@${digest}; the registry needs delete support (flag registry-tag-pruning) and the push identity`,
        );
      }
    },
  };
}
