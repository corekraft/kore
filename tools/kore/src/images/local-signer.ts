import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { localSigningConfigArgs } from "./local-image-args.js";

export const localSigningKeyNamespace = "kore-system";
export const localSigningKeySecret = "kore-local-signing-key";
const localSigningKeyReference = `k8s://${localSigningKeyNamespace}/${localSigningKeySecret}`;

export interface LocalSigner {
  key: string;
  publicKey: string;
  signingConfig: string;
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
}

async function writePublicKey(
  runner: Runner,
  kubeContext: string,
  state: string,
): Promise<string> {
  const encoded = await runner.run(
    "kubectl",
    secretArgs(kubeContext, "--output=jsonpath={.data.cosign\\.pub}"),
    { capture: true },
  );
  const publicKey = join(state, "local-signing.pub");
  await mkdir(state, { recursive: true });
  await writeFile(
    publicKey,
    Buffer.from(encoded.stdout.trim(), "base64").toString("utf8"),
  );
  return publicKey;
}

async function ensureSigningConfig(
  runner: Runner,
  state: string,
): Promise<string> {
  const signingConfig = join(state, "local-signing-config.json");
  if (!(await exists(signingConfig))) {
    await runner.run("cosign", localSigningConfigArgs(signingConfig), {
      capture: false,
    });
  }
  return signingConfig;
}

// Cosign resolves k8s:// references through the kubeconfig's current context,
// so the configured context is pinned with a minified, credential-free
// kubeconfig that only lives for the duration of the signing call.
export async function withLocalSigner<T>(
  repository: Repository,
  runner: Runner,
  action: (signer: LocalSigner) => Promise<T>,
): Promise<T> {
  const kubeContext = repository.environment.kubeContext;
  const state = join(repository.root, ".kore", "state");
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
    const publicKey = await writePublicKey(runner, kubeContext, state);
    const signingConfig = await ensureSigningConfig(runner, state);
    return await action({
      key: localSigningKeyReference,
      publicKey,
      signingConfig,
      env,
    });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}
