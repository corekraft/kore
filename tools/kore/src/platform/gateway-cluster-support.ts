import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { loadRepository } from "../config/index.js";
import { ProcessRunner, liveEnvironment } from "../runtime/index.js";
import type { Runner } from "../runtime/index.js";
import { proofManifests } from "./gateway-proof.js";
import type { Json, ProofOptions } from "./gateway-proof.js";

// Docs: docs/decisions/0013-local-tls-before-gateway.md
// Live-only helpers for gateway.live.spec.ts. Nothing here reads or
// prints a Secret value.

type Repository = Awaited<ReturnType<typeof loadRepository>>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls `work` until `problem` finds nothing wrong, naming the last problem. */
export async function eventually<T>(
  what: string,
  work: () => Promise<T>,
  problem: (value: T) => string | undefined,
  attempts = 60,
): Promise<T> {
  let last = "not attempted";
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const value = await work();
      const found = problem(value);
      if (found === undefined) {
        return value;
      }
      last = found;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await sleep(2000);
  }
  return assert.fail(`${what} never became ready: ${last}`);
}

export class Cluster {
  constructor(
    readonly repository: Repository,
    readonly runner: Runner,
  ) {}

  async kubectl(args: string[], input?: string): Promise<string> {
    const context = this.repository.environment.kubeContext;
    const result = await this.runner.run(
      "kubectl",
      ["--context", context, ...args],
      { capture: true, ...(input === undefined ? {} : { input }) },
    );
    return result.stdout;
  }

  async json(args: string[]): Promise<Json> {
    return JSON.parse(await this.kubectl([...args, "--output", "json"]));
  }

  async apply(manifests: object[]): Promise<void> {
    await this.kubectl(
      ["apply", "--filename", "-"],
      manifests.map((doc) => JSON.stringify(doc)).join("\n---\n"),
    );
  }
}

async function reference(cluster: Cluster, field: string): Promise<string> {
  const path = `{.spec.template.spec.containers[0].${field}}`;
  return (
    await cluster.kubectl([
      "--namespace",
      "reference",
      "get",
      "deployment/reference-frontend",
      "--output",
      `jsonpath=${path}`,
    ])
  ).trim();
}

async function proofOptions(
  cluster: Cluster,
  namespace: string,
): Promise<ProofOptions> {
  const { gateway, secrets } = cluster.repository.environment;
  // The echo backend runs the exact image the reference app already runs: it
  // is signed, admitted, and present on the node, so nothing new is approved.
  const image = await reference(cluster, "image");
  assert.match(image, /@sha256:[0-9a-f]{64}$/, "the reference image is pinned");
  return {
    namespace,
    hostname: gateway.hostname,
    gateway: { name: gateway.name, namespace: gateway.namespace },
    image,
    pullPolicy: await reference(cluster, "imagePullPolicy"),
    storeName: secrets.storeName,
    source: { key: "reference-app", property: "API_TOKEN" },
    target: { secret: "proof-target", key: "PROOF_KEY" },
  };
}

/** Applies the proof objects in a throwaway namespace, removed in `finally`. */
export async function withProofNamespace(
  fn: (cluster: Cluster, options: ProofOptions) => Promise<void>,
): Promise<void> {
  const repository = await loadRepository(liveEnvironment());
  const cluster = new Cluster(repository, new ProcessRunner());
  const namespace = `kore-proof-${randomBytes(3).toString("hex")}`;
  try {
    const options = await proofOptions(cluster, namespace);
    await cluster.apply(proofManifests(options));
    await fn(cluster, options);
  } finally {
    await cluster.kubectl([
      "delete",
      "namespace",
      namespace,
      "--ignore-not-found",
      "--wait=false",
    ]);
  }
}

export async function mkcertRoot(runner: Runner): Promise<string> {
  const result = await runner.run("mkcert", ["-CAROOT"], { capture: true });
  return result.stdout.trim();
}

/** Curl the HTTPS endpoint verifying the kore local CA; never `--insecure`. */
export async function httpsGet(
  cluster: Cluster,
  options: ProofOptions,
  root: string,
  path: string,
): Promise<{ status: number; body: string }> {
  const { port } = cluster.repository.environment.gateway;
  const { stdout } = await cluster.runner.run(
    "curl",
    [
      "--silent",
      "--show-error",
      "--cacert",
      `${root}/rootCA.pem`,
      "--write-out",
      "\n%{http_code}",
      "--resolve",
      `${options.hostname}:${port}:127.0.0.1`,
      `https://${options.hostname}:${port}${path}`,
    ],
    { capture: true },
  );
  const boundary = stdout.lastIndexOf("\n");
  return {
    status: Number(stdout.slice(boundary + 1)),
    body: stdout.slice(0, boundary),
  };
}

export function conditionHolds(
  resource: Json,
  type: string,
): string | undefined {
  const status = resource.status as { conditions?: Json[] } | undefined;
  const found = (status?.conditions ?? []).find(
    (condition) => condition.type === type,
  ) as { status?: string; reason?: string } | undefined;
  return found?.status === "True"
    ? undefined
    : `${type} is ${found?.status ?? "unreported"} (${found?.reason ?? "no reason"})`;
}

export async function helmRevisions(cluster: Cluster): Promise<string[]> {
  const result = await cluster.runner.run(
    "helm",
    [
      "--kube-context",
      cluster.repository.environment.kubeContext,
      "list",
      // Helm 4 lists releases in every status by default and has no --all.
      "--all-namespaces",
      "--output",
      "json",
    ],
    { capture: true },
  );
  return (JSON.parse(result.stdout) as Json[])
    .map(
      (r) => `${String(r.namespace)}/${String(r.name)}@${String(r.revision)}`,
    )
    .sort();
}
