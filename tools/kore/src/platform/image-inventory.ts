import type { Repository } from "../config/index.js";
import { approvedImageList } from "../config/index.js";
import type { Runner } from "../runtime/index.js";

/**
 * Read-only inventory of the images that run in the catalog-managed platform
 * namespaces (plan Step 7, ADR 0056). Every container, init container and
 * ephemeral container of a live pod is classified; `audit` reports the findings
 * and `enforce` fails bootstrap on any image that is not an approved internal
 * digest. The inventory only ever issues `kubectl get`.
 */
export const enrollmentLabel = "policy.sigstore.dev/include";
export const imageInventoryStatusName = "image-inventory";

export type ImageClassification =
  | "internal-digest"
  | "approved-upstream-digest"
  | "seed"
  | "tag-only"
  | "unknown";

export interface InventoriedImage {
  namespace: string;
  pod: string;
  container: string;
  kind: "container" | "init" | "ephemeral";
  image: string;
  classification: ImageClassification;
}

export interface ImageInventory {
  mode: "audit" | "enforce";
  images: InventoriedImage[];
  unenrolledNamespaces: string[];
}

export interface ImageInventoryStatus {
  name: string;
  namespace: string;
  status: "ready" | "degraded";
  detail: string;
  inventory?: ImageInventory;
}

const digestOf = /@(sha256:[0-9a-f]{64})$/;

function platformNamespaces(repository: Repository): string[] {
  return [
    ...new Set(repository.catalog.components.map((c) => c.namespace)),
  ].sort();
}

/** Registry prefixes whose digests are internal: the mirror and the registry. */
function internalPrefixes(repository: Repository): string[] {
  const { platformMirror, registry } = repository.environment;
  return [platformMirror, registry.address].flatMap((prefix) =>
    prefix ? [`${prefix}/`] : [],
  );
}

export function classifyImage(
  repository: Repository,
  image: string,
): ImageClassification {
  const digest = digestOf.exec(image)?.[1];
  if (digest === undefined) {
    return "tag-only";
  }
  const entries = approvedImageList(repository).filter((entry) =>
    entry.image.endsWith(`@${digest}`),
  );
  if (internalPrefixes(repository).some((prefix) => image.startsWith(prefix))) {
    return entries.length ? "internal-digest" : "unknown";
  }
  if (entries.some((entry) => entry.seed)) {
    return "seed";
  }
  return entries.length ? "approved-upstream-digest" : "unknown";
}

interface PodList {
  items?: {
    metadata: { namespace: string; name: string };
    status?: { phase?: string };
    spec?: Record<string, { name: string; image: string }[] | undefined>;
  }[];
}

interface NamespaceList {
  items?: { metadata: { name: string; labels?: Record<string, string> } }[];
}

const containerKinds = [
  ["containers", "container"],
  ["initContainers", "init"],
  ["ephemeralContainers", "ephemeral"],
] as const;

async function kubectlJson<T>(
  repository: Repository,
  runner: Runner,
  args: string[],
): Promise<T> {
  const { stdout } = await runner.run(
    "kubectl",
    [
      "--context",
      repository.environment.kubeContext,
      "get",
      ...args,
      "-o",
      "json",
    ],
    { capture: true },
  );
  return JSON.parse(stdout) as T;
}

export async function imageInventory(
  repository: Repository,
  runner: Runner,
): Promise<ImageInventory> {
  const namespaces = new Set(platformNamespaces(repository));
  const pods = await kubectlJson<PodList>(repository, runner, [
    "pods",
    "--all-namespaces",
  ]);
  const labelled = await kubectlJson<NamespaceList>(repository, runner, [
    "namespaces",
  ]);
  const images = (pods.items ?? [])
    .filter(
      (pod) =>
        namespaces.has(pod.metadata.namespace) &&
        pod.status?.phase !== "Succeeded" &&
        pod.status?.phase !== "Failed",
    )
    .flatMap((pod) =>
      containerKinds.flatMap(([field, kind]) =>
        (pod.spec?.[field] ?? []).map((container) => ({
          namespace: pod.metadata.namespace,
          pod: pod.metadata.name,
          container: container.name,
          kind,
          image: container.image,
          classification: classifyImage(repository, container.image),
        })),
      ),
    );
  const enrolled = new Set(
    (labelled.items ?? [])
      .filter((ns) => ns.metadata.labels?.[enrollmentLabel] === "true")
      .map((ns) => ns.metadata.name),
  );
  return {
    mode: repository.environment.imageInventory ?? "audit",
    images,
    unenrolledNamespaces: [...namespaces].filter((ns) => !enrolled.has(ns)),
  };
}

function offending(inventory: ImageInventory): InventoriedImage[] {
  return inventory.images.filter(
    (image) => image.classification !== "internal-digest",
  );
}

function summary(inventory: ImageInventory): string {
  const counts = new Map<ImageClassification, number>();
  for (const image of offending(inventory)) {
    counts.set(
      image.classification,
      (counts.get(image.classification) ?? 0) + 1,
    );
  }
  const parts = [...counts].map(([name, count]) => `${count} ${name}`);
  if (inventory.unenrolledNamespaces.length) {
    parts.push(
      `${inventory.unenrolledNamespaces.length} namespace(s) not enrolled`,
    );
  }
  return parts.length ? parts.join(", ") : "every image is an internal digest";
}

function violations(inventory: ImageInventory): string[] {
  return [
    ...offending(inventory).map(
      (i) =>
        `${i.namespace}/${i.pod} ${i.kind === "container" ? "container" : `${i.kind} container`} ${i.container} ${i.image} (${i.classification})`,
    ),
    ...inventory.unenrolledNamespaces.map(
      (ns) => `namespace ${ns} lacks ${enrollmentLabel}=true`,
    ),
  ];
}

/** The inventory as a platform status row; `enforce` findings are degraded. */
export async function imageInventoryStatus(
  repository: Repository,
  runner: Runner,
): Promise<ImageInventoryStatus> {
  const identity = { name: imageInventoryStatusName, namespace: "cluster" };
  let inventory: ImageInventory;
  try {
    inventory = await imageInventory(repository, runner);
  } catch (error) {
    return {
      ...identity,
      status: "degraded",
      detail: `image inventory could not be read: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const found = violations(inventory);
  if (inventory.mode === "enforce" && found.length) {
    return {
      ...identity,
      status: "degraded",
      detail: `enforce: ${found.join("; ")}`,
      inventory,
    };
  }
  return {
    ...identity,
    status: "ready",
    detail: `${inventory.mode}: ${summary(inventory)}`,
    inventory,
  };
}
