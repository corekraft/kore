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
// The checksum a consumer's Deployment last rolled for, set on the token Secret
// only after that restart succeeds, so a failed restart is retried by a rerun.
const rolledKey = "platform.kore.dev/rolled-document-sha256";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The kubectl arguments that name a consumer's namespace in the configured context. */
function inContext(context: string, consumer: TokenConsumer): string[] {
  return ["--context", context, "--namespace", consumer.namespace];
}

/** The checksum the live token Secret records as rolled; undefined when there is no Secret or it has none. */
async function rolledChecksum(
  context: string,
  consumer: TokenConsumer,
  runner: Runner,
): Promise<string | undefined> {
  const { stdout } = await runner.run(
    "kubectl",
    [
      ...inContext(context, consumer),
      "get",
      "secret",
      cloudflareTokenSecretName,
      "--ignore-not-found",
      "--output=json",
    ],
    { capture: true },
  );
  const secret: unknown = stdout.trim() === "" ? undefined : JSON.parse(stdout);
  const metadata = isRecord(secret) ? secret.metadata : undefined;
  const annotations = isRecord(metadata) ? metadata.annotations : undefined;
  const rolled = isRecord(annotations) ? annotations[rolledKey] : undefined;
  return typeof rolled === "string" ? rolled : undefined;
}

/**
 * Whether applying a document rolls its consumer: its Deployment exists, and the
 * checksum recorded on the live Secret as rolled is not this document's. A failed
 * restart records nothing, so the next run retries it.
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
  if ((await rolledChecksum(context, consumer, runner)) === checksum) {
    return false;
  }
  const { stdout } = await runner.run(
    "kubectl",
    [
      ...inContext(context, consumer),
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
 * Rolls a consumer's Deployment once, then records the rolled checksum on the token
 * Secret, only after the restart succeeds. The Deployment is never annotated: Helm owns it.
 */
async function rollConsumer(
  context: string,
  prepared: PreparedToken,
  runner: Runner,
): Promise<void> {
  const { consumer, checksum } = prepared;
  const args = [
    ...inContext(context, consumer),
    "rollout",
    "restart",
    `deployment/${consumer.deployment}`,
  ];
  try {
    await runner.run("kubectl", args, { capture: true });
  } catch (error) {
    throw new Error(
      `the ${consumer.name} token Secret was applied, but restarting its Deployment failed: ${errorText(error)}. Rerun kore secrets tokens to retry the restart, because the Secret does not record the rolled checksum until a restart succeeds; or restart it by hand with: kubectl ${args.join(" ")}`,
    );
  }
  try {
    await runner.run(
      "kubectl",
      [
        ...inContext(context, consumer),
        "annotate",
        "secret",
        cloudflareTokenSecretName,
        `${rolledKey}=${checksum}`,
        "--overwrite",
      ],
      { capture: true },
    );
  } catch (error) {
    throw new Error(
      `the ${consumer.name} Deployment restarted, but recording the rolled checksum on its token Secret failed: ${errorText(error)}. Rerun kore secrets tokens; it restarts the Deployment once more, then records the checksum`,
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
  const rolling: PreparedToken[] = [];
  for (const entry of prepared) {
    if (await rollsConsumer(environment.kubeContext, entry, runner)) {
      rolling.push(entry);
    }
  }
  await withSecretsRedacted(
    prepared.map(({ token }) => token),
    async () => {
      for (const { consumer, token, checksum } of prepared) {
        await runner.run(
          "kubectl",
          [
            ...inContext(environment.kubeContext, consumer),
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
  for (const entry of rolling) {
    await rollConsumer(environment.kubeContext, entry, runner);
  }
  return prepared.map(({ consumer }) => ({
    consumer: consumer.name,
    namespace: consumer.namespace,
  }));
}
