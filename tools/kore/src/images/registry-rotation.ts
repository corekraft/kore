import { randomBytes } from "node:crypto";
import type { Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import {
  applyRegistryCredentials,
  existingCredentials,
  generated,
  htpasswdLine,
  koreManagesRegistryAuth,
  registryAddress,
  registryHtpasswdSecret,
  registryNamespace,
  registryPullSecret,
  withSecretsRedacted,
} from "./registry-auth.js";
import type { RegistryCredentials } from "./registry-auth.js";

// Docs: docs/decisions/0055-registry-credential-rotation.md

// The label `kore app up` puts on every namespace it enrolls in image
// admission (ADR 0032); each such namespace holds a `kore-registry-read` Secret.
const enrollmentLabel = "policy.sigstore.dev/include=true";
const htpasswdPath = "/etc/nginx/auth/htpasswd";

export interface RotationOptions {
  /** Consent: rotation invalidates every credential issued so far. */
  yes: boolean;
  /** Proxy checks before giving up; the kubelet syncs a mounted Secret in ~1 minute. */
  attempts?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export interface RotationResult {
  namespaces: string[];
}

function kubectl(repository: Repository, ...args: string[]): string[] {
  return ["--context", repository.environment.kubeContext, ...args];
}

async function currentHtpasswdLines(
  repository: Repository,
  runner: Runner,
): Promise<string[]> {
  const { stdout } = await runner.run(
    "kubectl",
    kubectl(
      repository,
      "--namespace",
      registryNamespace,
      "get",
      "secret",
      registryHtpasswdSecret,
      "--ignore-not-found",
      "--output=json",
    ),
    { capture: true },
  );
  if (stdout.trim() === "") {
    return [];
  }
  const data = (JSON.parse(stdout) as { data?: Record<string, string> }).data;
  return Buffer.from(data?.["htpasswd"] ?? "", "base64")
    .toString("utf8")
    .split("\n")
    .filter((line) => line !== "");
}

async function enrolledNamespaces(
  repository: Repository,
  runner: Runner,
): Promise<string[]> {
  const { stdout } = await runner.run(
    "kubectl",
    kubectl(
      repository,
      "get",
      "namespaces",
      "--selector",
      enrollmentLabel,
      "--output=jsonpath={.items[*].metadata.name}",
    ),
    { capture: true },
  );
  return stdout.split(/\s+/).filter((name) => name !== "");
}

/**
 * Waits until the proxy's mounted htpasswd holds exactly `expected`. nginx
 * reads `auth_basic_user_file` on every request, so it needs no reload; the
 * only delay is the kubelet syncing the Secret volume. Reading the file back
 * from the proxy proves what it serves instead of assuming a sleep was long
 * enough. The file holds hashes only.
 */
async function waitForProxy(
  repository: Repository,
  runner: Runner,
  expected: readonly string[],
  options: RotationOptions,
): Promise<void> {
  const attempts = options.attempts ?? 40;
  const sleep =
    options.sleep ??
    (async (ms) => await new Promise((r) => setTimeout(r, ms)));
  const want = [...expected].sort().join("\n");
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const { stdout } = await runner.run(
      "kubectl",
      kubectl(
        repository,
        "--namespace",
        registryNamespace,
        "exec",
        "deployment/oci-registry",
        "--container=proxy",
        "--",
        "cat",
        htpasswdPath,
      ),
      { capture: true },
    );
    const have = stdout
      .split("\n")
      .filter((line) => line !== "")
      .sort()
      .join("\n");
    if (have === want) {
      return;
    }
    if (attempt < attempts) {
      await sleep(5000);
    }
  }
  throw new Error(
    `the registry proxy did not serve the new credentials after ${attempts} checks (it reads ${htpasswdPath} from the ${registryHtpasswdSecret} Secret, which the kubelet syncs into the pod); no pull Secret was changed. Check the oci-registry pod is Ready, then rerun \`kore registry rotate-credentials --yes\`, which is safe to repeat`,
  );
}

async function applyPullSecret(
  repository: Repository,
  runner: Runner,
  namespace: string,
  credentials: RegistryCredentials,
): Promise<void> {
  await runner.run(
    "kubectl",
    kubectl(
      repository,
      "apply",
      "--server-side",
      "--field-manager=kore-app",
      "--force-conflicts",
      "--filename=-",
    ),
    {
      capture: true,
      input: JSON.stringify({
        apiVersion: "v1",
        kind: "List",
        items: [
          registryPullSecret(
            registryAddress(repository),
            credentials.read,
            namespace,
          ),
        ],
      }),
    },
  );
}

/**
 * Replaces the registry's push and read passwords, keeping signature access
 * for admission throughout. The order is the guarantee (ADR 0055):
 *
 * 1. Apply the new credentials with the new read identity under a new
 *    username, while the htpasswd keeps every earlier read line. The proxy
 *    accepts old and new read identities side by side. The old push identity
 *    ends here; only kore, under the environment lock, uses it.
 * 2. Wait until the proxy serves that file.
 * 3. Replace each enrolled namespace's pull Secret, one at a time. Whether a
 *    namespace holds the old or the new read credential, the proxy accepts it.
 * 4. Drop the earlier read lines and wait again, so on return the old
 *    passwords are refused.
 *
 * The new passwords are persisted at step 1, before anything depends on them,
 * so a rerun after any failure continues from the cluster's state: it retains
 * whatever read lines the proxy still holds and rotates again.
 */
export async function rotateRegistryCredentials(
  repository: Repository,
  runner: Runner,
  options: RotationOptions,
): Promise<RotationResult> {
  if (!options.yes) {
    throw new Error(
      "rotating the registry credentials invalidates every credential issued so far and requires --yes",
    );
  }
  if (!koreManagesRegistryAuth(repository)) {
    throw new Error(
      `environment ${repository.environment.name} uses an external registry whose credentials the provider owns; rotate them there`,
    );
  }
  const previous = await existingCredentials(repository, runner);
  if (previous === undefined) {
    throw new Error(
      `registry credentials Secret ${registryNamespace}/oci-registry-credentials is missing or incomplete; run \`kore platform up --env ${repository.environment.name}\` to create it`,
    );
  }
  const next = generated(`kore-read-${randomBytes(4).toString("hex")}`);
  const secrets = [
    previous.push.password,
    previous.read.password,
    next.push.password,
    next.read.password,
  ];
  return await withSecretsRedacted(secrets, async () => {
    const retained = [
      ...new Set([
        htpasswdLine(previous.read),
        ...(await currentHtpasswdLines(repository, runner)).filter((line) =>
          line.startsWith("kore-read"),
        ),
      ]),
    ].filter((line) => !line.startsWith(`${next.read.username}:`));
    await applyRegistryCredentials(repository, runner, next, retained);
    await waitForProxy(
      repository,
      runner,
      [htpasswdLine(next.push), htpasswdLine(next.read), ...retained],
      options,
    );
    const namespaces = await enrolledNamespaces(repository, runner);
    for (const namespace of namespaces) {
      await applyPullSecret(repository, runner, namespace, next);
    }
    await applyRegistryCredentials(repository, runner, next);
    await waitForProxy(
      repository,
      runner,
      [htpasswdLine(next.push), htpasswdLine(next.read)],
      options,
    );
    return { namespaces };
  });
}
