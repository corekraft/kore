import { readdir } from "node:fs/promises";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { Repository } from "../config/index.js";
import { assertExpectedCluster } from "../cluster/index.js";
import type { Runner } from "../runtime/index.js";

async function ensureLocalReferenceSecret(
  repository: Repository,
  runner: Runner,
  namespace: string,
): Promise<void> {
  const state = join(repository.root, ".kore", "state");
  const tokenPath = join(state, "reference-api-token");
  await mkdir(state, { recursive: true, mode: 0o700 });
  let token: string;
  try {
    token = (await readFile(tokenPath, "utf8")).trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    token = randomBytes(32).toString("hex");
    try {
      await writeFile(tokenPath, `${token}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
    } catch (writeError) {
      if ((writeError as NodeJS.ErrnoException).code !== "EEXIST") {
        throw writeError;
      }
      token = (await readFile(tokenPath, "utf8")).trim();
    }
  }
  if (!/^[a-f0-9]{64}$/.test(token)) {
    throw new Error(
      `local API token at ${tokenPath} is invalid; remove it to generate a new token`,
    );
  }
  await chmod(tokenPath, 0o600);
  const secret = {
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name: "reference-app",
      namespace,
      labels: { "platform.kore.dev/secret-source": "true" },
    },
    type: "Opaque",
    data: { API_TOKEN: Buffer.from(token).toString("base64") },
  };
  await runner.run(
    "kubectl",
    [
      "--context",
      repository.environment.kubeContext,
      "--namespace",
      namespace,
      "apply",
      "--server-side",
      "--field-manager=kore-secrets",
      "--filename",
      "-",
    ],
    { capture: true, input: `${JSON.stringify(secret)}\n` },
  );
}

function applyArgs(context: string, namespace?: string): string[] {
  return [
    "--context",
    context,
    ...(namespace ? ["--namespace", namespace] : []),
    "apply",
    "--server-side",
    "--field-manager=kore-secrets",
    "--filename",
    "-",
  ];
}

async function ensureSourceNamespace(
  runner: Runner,
  context: string,
  namespace: string,
): Promise<void> {
  const manifest = `apiVersion: v1\nkind: Namespace\nmetadata:\n  name: ${namespace}\n  labels:\n    platform.kore.dev/secret-source: "true"\n`;
  await runner.run("kubectl", applyArgs(context), {
    capture: true,
    input: manifest,
  });
}

// Plaintext is streamed from sops into kubectl stdin and never written to disk.
async function applyEncryptedSecrets(
  repository: Repository,
  runner: Runner,
  namespace: string,
): Promise<number> {
  const directory = join(
    repository.root,
    "infra/environments",
    repository.environment.name,
    "secrets",
  );
  const files = (await readdir(directory))
    .filter((file) => file.endsWith(".enc.yaml"))
    .sort();
  for (const file of files) {
    const decrypted = await runner.run(
      "sops",
      ["--decrypt", join(directory, file)],
      { capture: true },
    );
    await runner.run(
      "kubectl",
      applyArgs(repository.environment.kubeContext, namespace),
      { capture: true, input: decrypted.stdout },
    );
  }
  return files.length;
}

async function forceReferenceResync(
  runner: Runner,
  context: string,
): Promise<void> {
  const externalSecret = await runner.run(
    "kubectl",
    [
      "--context",
      context,
      "--namespace",
      "reference",
      "get",
      "externalsecret",
      "reference-app",
      "--ignore-not-found",
      "-o",
      "name",
    ],
    { capture: true },
  );
  if (!externalSecret.stdout.trim()) {
    return;
  }
  await runner.run(
    "kubectl",
    [
      "--context",
      context,
      "--namespace",
      "reference",
      "annotate",
      "externalsecret",
      "reference-app",
      `force-sync=${Date.now()}`,
      "--overwrite",
    ],
    { capture: true },
  );
}

export async function syncLocalSecrets(
  repository: Repository,
  runner: Runner,
): Promise<number> {
  if (repository.environment.provider !== "minikube") {
    throw new Error(
      "local SOPS synchronization is only valid for a Minikube environment",
    );
  }
  await assertExpectedCluster(repository, runner);
  const context = repository.environment.kubeContext;
  const namespace = repository.environment.secrets.sourceNamespace;
  await ensureSourceNamespace(runner, context, namespace);
  await ensureLocalReferenceSecret(repository, runner, namespace);
  const count = await applyEncryptedSecrets(repository, runner, namespace);
  await forceReferenceResync(runner, context);
  return count;
}
