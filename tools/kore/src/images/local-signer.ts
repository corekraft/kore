import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localSigner, trustedSigners } from "../config/index.js";
import type { Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";

export const localSigningKeyNamespace = "kore-system";
export const localSigningKeySecret = "kore-local-signing-key";
// Policy Controller reads key Secrets from its own namespace and requires
// exactly one data entry, so it gets a public-key-only copy (ADR 0028).
export const localSigningPublicNamespace = "cosign-system";
export const localSigningPublicSecret = "kore-local-signing-pub";
const localSigningKeyReference = `k8s://${localSigningKeyNamespace}/${localSigningKeySecret}`;

export interface LocalSigner {
  key: string;
  publicKey: string;
  env: NodeJS.ProcessEnv;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function secretArgs(kubeContext: string, ...rest: string[]): string[] {
  return [
    "--context",
    kubeContext,
    "--namespace",
    localSigningKeyNamespace,
    "get",
    "secret",
    localSigningKeySecret,
    ...rest,
  ];
}

async function warnAboutLegacyKey(repository: Repository): Promise<void> {
  const legacy = join(repository.root, ".kore", "keys", "local");
  if (await exists(legacy)) {
    process.stderr.write(
      `legacy local signing key under ${legacy} is no longer used and can be deleted; the key now lives in the ${localSigningKeyNamespace}/${localSigningKeySecret} Secret for the cluster's lifetime\n`,
    );
  }
}

async function minifiedKubeconfig(
  runner: Runner,
  kubeContext: string,
): Promise<string> {
  const kubeconfig = (
    await runner.run(
      "kubectl",
      ["config", "view", "--minify", "--context", kubeContext],
      { capture: true },
    )
  ).stdout;
  if (/(?:-data|token|password)\s*:/.test(kubeconfig)) {
    throw new Error(
      `kubeconfig context ${kubeContext} embeds credentials; reference certificate files instead so they are never copied to disk`,
    );
  }
  return kubeconfig;
}

async function ensureSigningKey(
  runner: Runner,
  kubeContext: string,
  env: NodeJS.ProcessEnv,
  scratch: string,
): Promise<void> {
  const present = await runner.run(
    "kubectl",
    secretArgs(kubeContext, "--ignore-not-found", "--output=name"),
    { capture: true },
  );
  if (!present.stdout.trim()) {
    await runner.run(
      "cosign",
      ["generate-key-pair", localSigningKeyReference],
      {
        capture: false,
        env,
        // cosign writes cosign.pub into its cwd; keep it out of the user's tree.
        cwd: scratch,
      },
    );
  }
  // cosign creates the Secret without labels. The ownership label is what lets
  // the secrets policy recognise this one exact Secret as kore's own key
  // material; it is applied on every run so an existing profile converges too.
  await runner.run(
    "kubectl",
    [
      "--context",
      kubeContext,
      "--namespace",
      localSigningKeyNamespace,
      "label",
      "secret",
      localSigningKeySecret,
      "app.kubernetes.io/managed-by=kore-signing",
      "--overwrite",
    ],
    { capture: true },
  );
}

async function readPublicKey(
  runner: Runner,
  kubeContext: string,
): Promise<string> {
  const encoded = await runner.run(
    "kubectl",
    secretArgs(kubeContext, "--output=jsonpath={.data.cosign\\.pub}"),
    { capture: true },
  );
  return encoded.stdout.trim();
}

async function writePublicKey(
  publicKeyBase64: string,
  state: string,
): Promise<string> {
  const publicKey = join(state, "local-signing.pub");
  await mkdir(state, { recursive: true });
  await writeFile(
    publicKey,
    Buffer.from(publicKeyBase64, "base64").toString("utf8"),
  );
  return publicKey;
}

// Only the public half is ever copied; the manifest is streamed through stdin.
async function applyPublicSecret(
  runner: Runner,
  kubeContext: string,
  publicKeyBase64: string,
): Promise<void> {
  await runner.run(
    "kubectl",
    [
      "--context",
      kubeContext,
      "apply",
      "--server-side",
      "--field-manager=kore-signing",
      "--force-conflicts",
      "--filename=-",
    ],
    {
      capture: true,
      input: JSON.stringify({
        apiVersion: "v1",
        kind: "Secret",
        metadata: {
          name: localSigningPublicSecret,
          namespace: localSigningPublicNamespace,
          labels: {
            "app.kubernetes.io/managed-by": "kore-signing",
            "app.kubernetes.io/part-of": "kore-image-policy",
          },
        },
        type: "Opaque",
        data: { "cosign.pub": publicKeyBase64 },
      }),
    },
  );
}

async function withKeyPair<T>(
  repository: Repository,
  runner: Runner,
  action: (env: NodeJS.ProcessEnv, publicKeyBase64: string) => Promise<T>,
): Promise<T> {
  const kubeContext = repository.environment.kubeContext;
  await warnAboutLegacyKey(repository);
  const kubeconfig = await minifiedKubeconfig(runner, kubeContext);
  const directory = await mkdtemp(join(tmpdir(), "kore-kubeconfig-"));
  try {
    const kubeconfigPath = join(directory, "config");
    await writeFile(kubeconfigPath, kubeconfig, { mode: 0o600 });
    const env = {
      ...process.env,
      KUBECONFIG: kubeconfigPath,
      COSIGN_PASSWORD: "",
    };
    await ensureSigningKey(runner, kubeContext, env, directory);
    const publicKeyBase64 = await readPublicKey(runner, kubeContext);
    await applyPublicSecret(runner, kubeContext, publicKeyBase64);
    return await action(env, publicKeyBase64);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

/** Ensures the key pair and its public-key-only Secret for Policy Controller. */
export async function ensureLocalSigningPublicKey(
  repository: Repository,
  runner: Runner,
): Promise<void> {
  await withKeyPair(repository, runner, async () => undefined);
}

// Cosign resolves k8s:// references through the kubeconfig's current context,
// so the configured context is pinned with a minified, credential-free
// kubeconfig that only lives for the duration of the signing call.
export async function withLocalSigner<T>(
  repository: Repository,
  runner: Runner,
  action: (signer: LocalSigner) => Promise<T>,
): Promise<T> {
  const state = join(repository.root, ".kore", "state");
  return await withKeyPair(repository, runner, async (env, publicKeyBase64) => {
    const publicKey = await writePublicKey(publicKeyBase64, state);
    return await action({
      key: localSigningKeyReference,
      publicKey,
      env,
    });
  });
}

/**
 * Replaces the local signing key pair (ADR 0028's key authority, swapped in
 * place). The old private key Secret is deleted first, then the normal path
 * generates a new pair and republishes the public-key-only Secret, so the old
 * public key stops being trusted the moment the new one is applied. Images
 * signed with the old key are denied afterwards and must be signed again.
 * Rerunning after a failure recovers: a missing private key is regenerated
 * and the public Secret is rewritten from whatever key the cluster holds.
 * Only the local environment trusts the local key; others refuse.
 */
export async function swapLocalSigningKey(
  repository: Repository,
  runner: Runner,
  options: { yes: boolean },
): Promise<void> {
  if (!trustedSigners(repository).includes(localSigner)) {
    throw new Error(
      `environment ${repository.environment.name} does not trust the local signing key; a key swap applies only to a local key authority. Rotate a managed signer through its release pipeline`,
    );
  }
  if (!options.yes) {
    throw new Error(
      "swapping the local signing key makes every image signed with the old key fail admission until it is signed again, and requires --yes",
    );
  }
  await runner.run(
    "kubectl",
    [
      "--context",
      repository.environment.kubeContext,
      "--namespace",
      localSigningKeyNamespace,
      "delete",
      "secret",
      localSigningKeySecret,
      "--ignore-not-found",
    ],
    { capture: true },
  );
  await ensureLocalSigningPublicKey(repository, runner);
}
