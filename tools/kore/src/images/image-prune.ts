import type { Repository } from "../config/index.js";
import { holdsHostLease, type Runner } from "../runtime/index.js";
import { shellQuote } from "./local-image-args.js";
import { requireK3d } from "./local-publish.js";

// Docs: docs/decisions/0094-worktrees-sharing-a-cluster-share-its-locks-tags-and-forward.md

/** The tags kore builds images under: the per-run tag, and the old shared one. */
const runTag =
  /^kore-local\/[a-z0-9._-]+:(kore-local|kore-local-[0-9a-f]{12})$/;

/** `docker.io/` is implied for an unqualified name, so compare without it. */
const bare = (name: string): string => name.replace(/^docker\.io\//, "");

const lines = (text: string): string[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

interface PodSpec {
  containers?: { image?: string }[];
  initContainers?: { image?: string }[];
}

/** Every image any pod in the cluster names. Throws when they cannot be listed. */
async function imagesInUse(
  repository: Repository,
  runner: Runner,
): Promise<Set<string>> {
  const listed = await runner.run(
    "kubectl",
    [
      "--context",
      repository.environment.kubeContext,
      "get",
      "pods",
      "--all-namespaces",
      "--output=json",
    ],
    { capture: true },
  );
  const items = (JSON.parse(listed.stdout) as { items?: { spec?: PodSpec }[] })
    .items;
  const images = (items ?? []).flatMap((pod) => [
    ...(pod.spec?.containers ?? []),
    ...(pod.spec?.initContainers ?? []),
  ]);
  return new Set(
    images.flatMap(({ image }) => (image === undefined ? [] : [bare(image)])),
  );
}

async function nodesOf(runner: Runner, clusterName: string): Promise<string[]> {
  const listed = await runner.run("docker", ["ps", "--format", "{{.Names}}"], {
    capture: true,
  });
  const prefix = `k3d-${clusterName}-`;
  return lines(listed.stdout).filter(
    (name) =>
      name.startsWith(prefix) &&
      /^(server|agent)-\d+$/.test(name.slice(prefix.length)),
  );
}

async function pruneNode(
  runner: Runner,
  node: string,
  inUse: Set<string>,
): Promise<void> {
  const listed = await runner.run(
    "docker",
    ["exec", node, "ctr", "--namespace", "k8s.io", "images", "ls", "-q"],
    { capture: true },
  );
  for (const name of lines(listed.stdout)) {
    if (runTag.test(bare(name)) && !inUse.has(bare(name))) {
      await runner.run(
        "docker",
        [
          "exec",
          node,
          "sh",
          "-c",
          `ctr --namespace k8s.io images rm ${shellQuote(name)}`,
        ],
        { capture: true },
      );
    }
  }
}

async function pruneHost(runner: Runner, inUse: Set<string>): Promise<void> {
  const listed = await runner.run(
    "docker",
    ["image", "ls", "kore-local/*", "--format", "{{.Repository}}:{{.Tag}}"],
    { capture: true },
  );
  for (const name of lines(listed.stdout)) {
    if (runTag.test(name) && !inUse.has(name)) {
      await runner.run("docker", ["image", "rm", name], { capture: true });
    }
  }
}

/**
 * Removes the build-time tags earlier runs left on the cluster's nodes and the
 * host: kore's own `kore-local-<run>` tags (and the old shared `kore-local`)
 * that no pod in the cluster uses. Workloads deploy by registry digest, so
 * these tags only fed the publish. It refuses unless this process holds the
 * host lease, so no live run's tag is pruned, and removes nothing when the
 * running workloads cannot be listed. Registry tags are not touched: the
 * registry does not allow deleting manifests (ADR 0094).
 */
export async function pruneStaleImageTags(
  repository: Repository,
  runner: Runner,
  holdsLease: () => Promise<boolean> = holdsHostLease,
): Promise<void> {
  if (!(await holdsLease())) {
    throw new Error(
      "refusing to prune image tags without the host lease: a live run's tags would be at risk. Run it from `kore local up`, which holds the lease",
    );
  }
  const { clusterName } = requireK3d(repository);
  const inUse = await imagesInUse(repository, runner);
  for (const node of await nodesOf(runner, clusterName)) {
    await pruneNode(runner, node, inUse);
  }
  await pruneHost(runner, inUse);
}
