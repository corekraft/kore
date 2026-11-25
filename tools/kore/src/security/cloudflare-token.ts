import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  featureEnabled,
  isLocalProvider,
  type Environment,
  type Repository,
} from "../config/index.js";
import { withSecretsRedacted } from "../images/index.js";
import type { Runner } from "../runtime/index.js";

// Docs: docs/decisions/0161-cert-manager-solves-dns-01-through-cloudflare-and-issues-per-suborg-wildcards-behind-acme-dns01.md, docs/decisions/0162-external-dns-publishes-route-records-for-the-external-gateway-behind-external-dns.md, docs/decisions/0163-one-cloudflare-zone-holds-the-platform-domain-opentofu-owns-fixed-records-and-external-dns-owns-route-records.md

export const cloudflareTokenSecretName = "cloudflare-token";
export const cloudflareTokenKey = "api-token";
const checksumAnnotation = "platform.kore.dev/document-sha256";

/**
 * A consumer of a Cloudflare token: the flag that needs it, the namespace its
 * plain Secret lives in, and the sops document under the environment's secrets
 * directory that holds the value. Each consumer has its own document and Secret,
 * so a revoked token fails one consumer and not both.
 */
export interface TokenConsumer {
  name: string;
  flag: string;
  namespace: string;
  document: string;
  /**
   * The Deployment that reads the token at start. Rolled once when its document
   * changes; a consumer that reads its token at challenge time has none.
   */
  deployment?: string;
}

export const tokenConsumers: readonly TokenConsumer[] = [
  {
    name: "external-dns",
    flag: "external-dns",
    namespace: "kore-external-dns",
    document: "cloudflare-external-dns.enc.yaml",
    deployment: "external-dns",
  },
  {
    name: "acme-dns01",
    flag: "acme-dns01",
    namespace: "cert-manager",
    document: "cloudflare-acme-dns01.enc.yaml",
  },
];

/** The consumers whose flag is on in an environment; a flag the overlay omits is off. */
export function activeTokenConsumers(
  environment: Pick<Environment, "features">,
  consumers: readonly TokenConsumer[] = tokenConsumers,
): TokenConsumer[] {
  return consumers.filter((consumer) =>
    featureEnabled(environment, consumer.flag),
  );
}

function documentPath(
  root: string,
  environmentName: string,
  consumer: TokenConsumer,
): string {
  return join(
    root,
    "infra/environments",
    environmentName,
    "secrets",
    consumer.document,
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function missingMessage(path: string, consumer: TokenConsumer): string {
  return `no token document at ${path}; create it with sops as a Secret named ${cloudflareTokenSecretName} in ${consumer.namespace} with stringData.${cloudflareTokenKey}, then rerun kore secrets tokens`;
}

function decryptMessage(path: string, error: unknown): string {
  return `could not decrypt ${path}: ${errorText(error)}; check that SOPS_AGE_KEY_FILE holds this environment's age identity and that .sops.yaml lists its recipient, then rerun kore secrets tokens`;
}

/**
 * The token a decrypted document holds, refused unless the document is a Secret
 * of the consumer's name and namespace. A refusal names the document and the fix,
 * never a value.
 */
function tokenFromDocument(
  text: string,
  consumer: TokenConsumer,
  path: string,
): string {
  const document = (JSON.parse(text) ?? {}) as {
    kind?: unknown;
    metadata?: { name?: unknown; namespace?: unknown };
    stringData?: Record<string, unknown>;
  };
  if (
    document.kind !== "Secret" ||
    document.metadata?.name !== cloudflareTokenSecretName
  ) {
    throw new Error(
      `${path} is not a Secret named ${cloudflareTokenSecretName}; set kind and metadata.name with sops, then rerun kore secrets tokens`,
    );
  }
  if (document.metadata.namespace !== consumer.namespace) {
    throw new Error(
      `${path} names namespace ${String(document.metadata.namespace)}, but ${consumer.name} reads its token from ${consumer.namespace}; set metadata.namespace to ${consumer.namespace} with sops, then rerun kore secrets tokens`,
    );
  }
  const token = document.stringData?.[cloudflareTokenKey];
  if (typeof token !== "string" || token === "") {
    throw new Error(
      `${path} has no stringData.${cloudflareTokenKey}; set the Cloudflare token under that key with sops, then rerun kore secrets tokens`,
    );
  }
  return token;
}

/** The plain Secret a consumer reads. Its annotation changes only with its document. */
export function tokenSecretManifest(
  consumer: TokenConsumer,
  token: string,
  checksum: string,
) {
  return {
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name: cloudflareTokenSecretName,
      namespace: consumer.namespace,
      annotations: { [checksumAnnotation]: checksum },
    },
    type: "Opaque",
    stringData: { [cloudflareTokenKey]: token },
  };
}

interface PreparedToken {
  consumer: TokenConsumer;
  token: string;
  checksum: string;
}

/** The checksum the live token Secret carries; undefined when there is no Secret or it has none. */
async function liveChecksum(
  context: string,
  consumer: TokenConsumer,
  runner: Runner,
): Promise<string | undefined> {
  const { stdout } = await runner.run(
    "kubectl",
    [
      "--context",
      context,
      "--namespace",
      consumer.namespace,
      "get",
      "secret",
      cloudflareTokenSecretName,
      "--ignore-not-found",
      "--output=json",
    ],
    { capture: true },
  );
  if (stdout.trim() === "") {
    return undefined;
  }
  const secret = JSON.parse(stdout) as {
    metadata?: { annotations?: Record<string, unknown> };
  };
  const checksum = secret.metadata?.annotations?.[checksumAnnotation];
  return typeof checksum === "string" ? checksum : undefined;
}

/**
 * Whether applying a document rolls its consumer: the document changed since the
 * live Secret was last applied, and the consumer's Deployment exists. A consumer
 * with no Deployment rolls nothing, and a first apply with no Deployment restarts nothing.
 */
async function rollsConsumer(
  context: string,
  prepared: PreparedToken,
  runner: Runner,
): Promise<boolean> {
  const { consumer, checksum } = prepared;
  if (consumer.deployment === undefined) {
    return false;
  }
  if ((await liveChecksum(context, consumer, runner)) === checksum) {
    return false;
  }
  const { stdout } = await runner.run(
    "kubectl",
    [
      "--context",
      context,
      "--namespace",
      consumer.namespace,
      "get",
      `deployment/${consumer.deployment}`,
      "--ignore-not-found",
      "--output=name",
    ],
    { capture: true },
  );
  return stdout.trim() !== "";
}

/**
 * Rolls a consumer's Deployment once, in the configured context. The Secret is
 * already applied, so a failed restart names the command to run by hand: a rerun
 * would find the new checksum and not retry it.
 */
async function rolloutRestart(
  context: string,
  consumer: TokenConsumer,
  runner: Runner,
): Promise<void> {
  const args = [
    "--context",
    context,
    "--namespace",
    consumer.namespace,
    "rollout",
    "restart",
    `deployment/${consumer.deployment}`,
  ];
  try {
    await runner.run("kubectl", args, { capture: true });
  } catch (error) {
    throw new Error(
      `the ${consumer.name} token Secret was applied, but restarting its Deployment failed: ${errorText(error)}. Restart it by hand with: kubectl ${args.join(" ")}; a rerun of kore secrets tokens would not restart it, because the Secret already carries the new checksum`,
    );
  }
}

/**
 * Reads and decrypts one consumer's document. sops prints the plaintext only on
 * stdout, captured in memory, so it never reaches disk or an argument. The
 * checksum is over the encrypted bytes, so an unchanged document changes nothing.
 */
async function prepare(
  root: string,
  environmentName: string,
  consumer: TokenConsumer,
  runner: Runner,
): Promise<PreparedToken> {
  const path = documentPath(root, environmentName, consumer);
  let encrypted: Buffer;
  try {
    encrypted = await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(missingMessage(path, consumer));
    }
    throw error;
  }
  let text: string;
  try {
    text = (
      await runner.run("sops", ["--decrypt", "--output-type", "json", path], {
        capture: true,
      })
    ).stdout;
  } catch (error) {
    throw new Error(decryptMessage(path, error));
  }
  return {
    consumer,
    token: tokenFromDocument(text, consumer, path),
    checksum: createHash("sha256").update(encrypted).digest("hex"),
  };
}

export interface AppliedCloudflareToken {
  consumer: string;
  namespace: string;
}

/**
 * Applies the Cloudflare token Secret of every consumer whose flag is on, from
 * its sops document, streamed to kubectl on stdin. Every document is read and
 * decrypted before the first kubectl call, so a missing or bad document changes
 * nothing in the cluster. A local environment applies nothing: its external-dns
 * runs with the inmemory provider and needs no token. With every flag off the
 * function reads nothing. A consumer whose document changed, with its Deployment
 * in place, has that Deployment rolled once after its Secret applies.
 */
export async function applyCloudflareTokens(
  repository: Repository,
  runner: Runner,
): Promise<AppliedCloudflareToken[]> {
  const { environment, root } = repository;
  if (isLocalProvider(environment)) {
    return [];
  }
  const consumers = activeTokenConsumers(environment);
  if (consumers.length === 0) {
    return [];
  }
  const prepared: PreparedToken[] = [];
  for (const consumer of consumers) {
    prepared.push(await prepare(root, environment.name, consumer, runner));
  }
  const rolling: TokenConsumer[] = [];
  for (const entry of prepared) {
    if (await rollsConsumer(environment.kubeContext, entry, runner)) {
      rolling.push(entry.consumer);
    }
  }
  await withSecretsRedacted(
    prepared.map(({ token }) => token),
    async () => {
      for (const { consumer, token, checksum } of prepared) {
        await runner.run(
          "kubectl",
          [
            "--context",
            environment.kubeContext,
            "--namespace",
            consumer.namespace,
            "apply",
            "--server-side",
            "--field-manager=kore-tokens",
            "--filename=-",
          ],
          {
            capture: true,
            input: `${JSON.stringify(tokenSecretManifest(consumer, token, checksum))}\n`,
          },
        );
      }
    },
  );
  for (const consumer of rolling) {
    await rolloutRestart(environment.kubeContext, consumer, runner);
  }
  return prepared.map(({ consumer }) => ({
    consumer: consumer.name,
    namespace: consumer.namespace,
  }));
}
