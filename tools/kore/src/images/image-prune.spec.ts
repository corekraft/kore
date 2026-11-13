import { describe, expect, it } from "vitest";
import type { Repository } from "../config/index.js";
import type { RunResult, Runner } from "../runtime/index.js";
import { pruneStaleImageTags } from "./image-prune.js";

// Docs: docs/decisions/0094-worktrees-sharing-a-cluster-share-its-locks-tags-and-forward.md

const repository = {
  root: "/repo",
  environment: {
    provider: "k3d",
    kubeContext: "k3d-kore-local",
    k3d: { clusterName: "kore-local" },
  },
} as unknown as Repository;

const old = "docker.io/kore-local/reference:kore-local-aaaaaaaaaaaa";
const busy = "docker.io/kore-local/reference:kore-local-bbbbbbbbbbbb";
const legacy = "docker.io/kore-local/reference:kore-local";
const foreign = [
  "docker.io/library/nginx:latest",
  "docker.io/kore-local/reference:kore-local-notahexvalue",
  `registry.kore.local:30500/reference@sha256:${"a".repeat(64)}`,
];

interface Cluster {
  podImages?: string[];
  nodeImages?: string[];
  hostImages?: string[];
  failPods?: boolean;
}

const ok = (stdout: string): RunResult => ({ stdout, stderr: "", code: 0 });

function podListing(options: Cluster): RunResult {
  if (options.failPods === true) {
    throw new Error("pod listing failed");
  }
  const containers = (options.podImages ?? []).map((image) => ({ image }));
  return ok(
    JSON.stringify({ items: [{ spec: { containers, initContainers: [] } }] }),
  );
}

function nodeExec(
  options: Cluster,
  args: readonly string[],
  removed: string[],
): RunResult {
  const script = args.at(-1) ?? "";
  if (script.includes("images rm")) {
    removed.push(`${args[1]}:${script.split("images rm ")[1]?.trim()}`);
    return ok("");
  }
  return ok(`${(options.nodeImages ?? []).join("\n")}\n`);
}

function docker(
  options: Cluster,
  args: readonly string[],
  removed: string[],
): RunResult {
  if (args[0] === "ps") {
    return ok(
      "k3d-kore-local-server-0\nk3d-kore-local-agent-0\nk3d-other-server-0\n",
    );
  }
  if (args[0] === "exec") {
    return nodeExec(options, args, removed);
  }
  if (args[0] === "image" && args[1] === "ls") {
    return ok(`${(options.hostImages ?? []).join("\n")}\n`);
  }
  if (args[0] === "image" && args[1] === "rm") {
    removed.push(`host:${args[2]}`);
  }
  return ok("");
}

function cluster(options: Cluster = {}) {
  const calls: string[] = [];
  const removed: string[] = [];
  const runner: Runner = {
    async run(command, args): Promise<RunResult> {
      calls.push([command, ...args].join(" "));
      if (command === "kubectl") {
        return podListing(options);
      }
      return command === "docker" ? docker(options, args, removed) : ok("");
    },
  };
  return { runner, calls, removed };
}

const leased = async () => true;

describe("pruning stale local image tags", () => {
  it("removes per-run and legacy tags nothing runs from, on every node and the host", async () => {
    const { runner, removed } = cluster({
      nodeImages: [old, legacy, ...foreign],
      hostImages: ["kore-local/reference:kore-local-cccccccccccc"],
    });

    await pruneStaleImageTags(repository, runner, leased);

    expect(removed.sort()).toEqual(
      [
        `k3d-kore-local-server-0:'${old}'`,
        `k3d-kore-local-server-0:'${legacy}'`,
        `k3d-kore-local-agent-0:'${old}'`,
        `k3d-kore-local-agent-0:'${legacy}'`,
        "host:kore-local/reference:kore-local-cccccccccccc",
      ].sort(),
    );
  });

  it("never removes a tag a running workload still uses", async () => {
    const { runner, removed } = cluster({
      podImages: ["kore-local/reference:kore-local-bbbbbbbbbbbb"],
      nodeImages: [old, busy],
    });

    await pruneStaleImageTags(repository, runner, leased);

    expect(removed.join("\n")).not.toContain(busy);
    expect(removed.join("\n")).toContain(old);
  });

  it("never removes an image that is not one of kore's own run tags", async () => {
    const { runner, removed } = cluster({ nodeImages: foreign });

    await pruneStaleImageTags(repository, runner, leased);

    expect(removed).toEqual([]);
  });

  it("only touches this cluster's nodes", async () => {
    const { runner, calls } = cluster({ nodeImages: [old] });

    await pruneStaleImageTags(repository, runner, leased);

    expect(calls.join("\n")).not.toContain("k3d-other-server-0");
  });

  it("refuses to prune unless this process holds the host lease", async () => {
    const { runner, calls, removed } = cluster({ nodeImages: [old] });

    await expect(
      pruneStaleImageTags(repository, runner, async () => false),
    ).rejects.toThrow(/host lease/);

    expect(removed).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("removes nothing when the running workloads cannot be listed", async () => {
    const { runner, removed } = cluster({
      nodeImages: [old],
      failPods: true,
    });

    await expect(
      pruneStaleImageTags(repository, runner, leased),
    ).rejects.toThrow(/pod listing failed/);

    expect(removed).toEqual([]);
  });
});
