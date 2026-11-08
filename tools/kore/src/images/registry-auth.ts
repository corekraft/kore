import { createHash, randomBytes } from "node:crypto";
import { registryPlan, type Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";

// Docs: docs/decisions/0034-registry-authentication-and-authorization.md

export const registryNamespace = "kore-registry";
export const registryCredentialsSecret = "oci-registry-credentials";
export const registryHtpasswdSecret = "oci-registry-auth";
export const registryPullSecretName = "kore-registry-read";
const fieldManager = "kore-registry-auth";

export type RegistryRole = "push" | "read";

export interface RegistryCredential {
  username: string;
  password: string;
}

const usernames: Record<RegistryRole, string> = {
  push: "kore-push",
  read: "kore-read",
};

const encode = (value: string): string =>
  Buffer.from(value, "utf8").toString("base64");
const decode = (value: string | undefined): string =>
  Buffer.from(value ?? "", "base64").toString("utf8");

type Credentials = Record<RegistryRole, RegistryCredential>;

function generated(): Credentials {
  // 256 random bits per identity: a slow password hash adds nothing at that
  // entropy, which is why {SHA} is enough and no bcrypt dependency is needed.
  const credential = (role: RegistryRole): RegistryCredential => ({
    username: usernames[role],
    password: randomBytes(32).toString("base64url"),
  });
  return { push: credential("push"), read: credential("read") };
}

function parsed(stdout: string): Credentials | undefined {
  if (stdout.trim() === "") {
    return undefined;
  }
  const data = (JSON.parse(stdout) as { data?: Record<string, string> }).data;
  const credentials: Credentials = {
    push: {
      username: decode(data?.["push-username"]),
      password: decode(data?.["push-password"]),
    },
    read: {
      username: decode(data?.["read-username"]),
      password: decode(data?.["read-password"]),
    },
  };
  const complete = Object.values(credentials).every(
    (credential) => credential.username !== "" && credential.password !== "",
  );
  return complete ? credentials : undefined;
}

function secretArgs(kubeContext: string): string[] {
  return [
    "--context",
    kubeContext,
    "--namespace",
    registryNamespace,
    "get",
    "secret",
    registryCredentialsSecret,
    "--ignore-not-found",
    "--output=json",
  ];
}

async function existingCredentials(
  repository: Repository,
  runner: Runner,
): Promise<Credentials | undefined> {
  const { stdout } = await runner.run(
    "kubectl",
    secretArgs(repository.environment.kubeContext),
    { capture: true },
  );
  return parsed(stdout);
}

function htpasswdLine(credential: RegistryCredential): string {
  const digest = createHash("sha1")
    .update(credential.password)
    .digest("base64");
  return `${credential.username}:{SHA}${digest}`;
}

function metadata(name: string): Record<string, unknown> {
  return {
    name,
    namespace: registryNamespace,
    labels: { "app.kubernetes.io/managed-by": fieldManager },
  };
}

function manifests(credentials: Credentials): unknown[] {
  return [
    {
      apiVersion: "v1",
      kind: "Namespace",
      metadata: { name: registryNamespace },
    },
    {
      apiVersion: "v1",
      kind: "Secret",
      metadata: metadata(registryCredentialsSecret),
      type: "Opaque",
      data: {
        "push-username": encode(credentials.push.username),
        "push-password": encode(credentials.push.password),
        "read-username": encode(credentials.read.username),
        "read-password": encode(credentials.read.password),
      },
    },
    {
      apiVersion: "v1",
      kind: "Secret",
      metadata: metadata(registryHtpasswdSecret),
      type: "Opaque",
      data: {
        htpasswd: encode(
          `${htpasswdLine(credentials.push)}\n${htpasswdLine(credentials.read)}\n`,
        ),
      },
    },
  ];
}

/**
 * Creates the registry's credentials once and reapplies them idempotently.
 * Passwords are generated in memory and reach the cluster only on kubectl's
 * stdin; the proxy mounts hashes, and kore's publish path reads the plaintext
 * back from the cluster when it needs it. Existing credentials are never
 * rotated here, so running pods keep working.
 */
export async function ensureRegistryAuth(
  repository: Repository,
  runner: Runner,
): Promise<void> {
  const credentials =
    (await existingCredentials(repository, runner)) ?? generated();
  await runner.run(
    "kubectl",
    [
      "--context",
      repository.environment.kubeContext,
      "apply",
      "--server-side",
      `--field-manager=${fieldManager}`,
      "--force-conflicts",
      "--filename=-",
    ],
    {
      capture: true,
      input: JSON.stringify({
        apiVersion: "v1",
        kind: "List",
        items: manifests(credentials),
      }),
    },
  );
}

export async function loadRegistryCredential(
  repository: Repository,
  runner: Runner,
  role: RegistryRole,
): Promise<RegistryCredential> {
  const credentials = await existingCredentials(repository, runner);
  if (credentials === undefined) {
    throw new Error(
      `registry credentials Secret ${registryNamespace}/${registryCredentialsSecret} is missing or incomplete; run \`kore platform up --env ${repository.environment.name}\` to create it`,
    );
  }
  return credentials[role];
}

/** A dockerconfigjson pull Secret holding only the read-only identity. */
export function registryPullSecret(
  address: string,
  credential: RegistryCredential,
  namespace: string,
): unknown {
  const auth = encode(`${credential.username}:${credential.password}`);
  return {
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name: registryPullSecretName,
      namespace,
      labels: { "app.kubernetes.io/managed-by": "kore-app" },
    },
    type: "kubernetes.io/dockerconfigjson",
    data: {
      ".dockerconfigjson": encode(
        JSON.stringify({
          auths: {
            [address]: {
              username: credential.username,
              password: credential.password,
              auth,
            },
          },
        }),
      ),
    },
  };
}

/** The address pull Secrets and client config are keyed by. */
export function registryAddress(repository: Repository): string {
  return registryPlan(repository.environment).address;
}

/**
 * Whether kore itself provides and authenticates this environment's registry.
 * A hostname address names an external registry whose credentials the
 * provider owns, so kore creates and distributes nothing for it.
 */
export function koreManagesRegistryAuth(repository: Repository): boolean {
  return registryPlan(repository.environment).clusterIP !== undefined;
}

/**
 * Runs `operation` and, if it fails, removes every secret from the error's
 * message and stack before rethrowing. A credentialed command's captured
 * output ends up in kore's error text, the journal, and logs, so a secret that
 * reaches that output (for example a terminal echoing stdin) must not survive.
 */
export async function withSecretsRedacted<T>(
  secrets: readonly string[],
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
    const redact = (text: string) =>
      secrets
        .filter((secret) => secret !== "")
        .reduce((out, secret) => out.replaceAll(secret, "[REDACTED]"), text);
    error.message = redact(error.message);
    if (error.stack) {
      error.stack = redact(error.stack);
    }
    throw error;
  }
}
