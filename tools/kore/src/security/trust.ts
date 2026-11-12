import { access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isLocalProvider, type Repository } from "../config/index.js";
import { assertExpectedCluster } from "../cluster/index.js";
import { CommandError } from "../runtime/index.js";
import type { Runner } from "../runtime/index.js";

export function issuerManifest(name: string, secretName: string): string {
  return `apiVersion: cert-manager.io/v1\nkind: ClusterIssuer\nmetadata:\n  name: ${name}\nspec:\n  ca:\n    secretName: ${secretName}\n`;
}

const certificateNamespace = "cert-manager";
const caSecret = "kore-local-ca-key-pair";

function applyArgs(context: string): string[] {
  return [
    "--context",
    context,
    "apply",
    "--server-side",
    "--field-manager=kore-trust",
    "--filename",
    "-",
  ];
}

async function ensureNamespaces(
  repository: Repository,
  runner: Runner,
): Promise<void> {
  const namespace = repository.environment.gateway.namespace;
  for (const targetNamespace of new Set([namespace, certificateNamespace])) {
    const ownership =
      targetNamespace === namespace
        ? "  labels:\n    app.kubernetes.io/managed-by: Helm\n  annotations:\n    meta.helm.sh/release-name: kore-platform-config\n    meta.helm.sh/release-namespace: kore-system\n"
        : "";
    await runner.run("kubectl", applyArgs(repository.environment.kubeContext), {
      capture: true,
      input: `apiVersion: v1\nkind: Namespace\nmetadata:\n  name: ${targetNamespace}\n${ownership}`,
    });
  }
}

async function readable(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

// mkcert has no read-only status command, so trust is inferred from the CA
// files plus the host's own verification. Anything uncertain reports false and
// the caller runs `mkcert -install`.
async function mkcertCaTrusted(
  runner: Runner,
  caRoot: string,
  platform: NodeJS.Platform,
): Promise<boolean> {
  if (platform !== "darwin") {
    return false;
  }
  const certificate = join(caRoot, "rootCA.pem");
  if (
    !(await readable(certificate)) ||
    !(await readable(join(caRoot, "rootCA-key.pem")))
  ) {
    return false;
  }
  try {
    await runner.run("security", ["verify-cert", "-c", certificate], {
      capture: true,
    });
    return true;
  } catch (error) {
    if (error instanceof CommandError) {
      return false;
    }
    throw error;
  }
}

async function mkcertRoot(
  runner: Runner,
  platform: NodeJS.Platform,
): Promise<string> {
  const rootResult = await runner.run("mkcert", ["-CAROOT"], { capture: true });
  const caRoot = rootResult.stdout.trim();
  if (!caRoot) {
    throw new Error("mkcert did not return its CA root");
  }
  if (!(await mkcertCaTrusted(runner, caRoot, platform))) {
    await runner.run("mkcert", ["-install"], { capture: false });
  }
  return caRoot;
}

async function applyCaSecret(
  repository: Repository,
  runner: Runner,
  caRoot: string,
): Promise<void> {
  const context = repository.environment.kubeContext;
  const secretYaml = (
    await runner.run(
      "kubectl",
      [
        "--context",
        context,
        "--namespace",
        certificateNamespace,
        "create",
        "secret",
        "tls",
        caSecret,
        "--cert",
        join(caRoot, "rootCA.pem"),
        "--key",
        join(caRoot, "rootCA-key.pem"),
        "--dry-run=client",
        "--output",
        "yaml",
      ],
      { capture: true },
    )
  ).stdout;
  await runner.run("kubectl", applyArgs(context), {
    capture: true,
    input: secretYaml,
  });
}

async function applyIssuer(
  repository: Repository,
  runner: Runner,
): Promise<void> {
  const context = repository.environment.kubeContext;
  await runner.run("kubectl", applyArgs(context), {
    capture: true,
    input: issuerManifest("kore-local-ca", caSecret),
  });
  await runner.run(
    "kubectl",
    [
      "--context",
      context,
      "wait",
      "--for=condition=Ready",
      "clusterissuer/kore-local-ca",
      "--timeout=2m",
    ],
    { capture: false },
  );
}

export async function installLocalTrust(
  repository: Repository,
  runner: Runner,
  options: { platform?: NodeJS.Platform } = {},
): Promise<void> {
  if (!isLocalProvider(repository.environment)) {
    throw new Error("local CA trust is only valid for a local k3d environment");
  }
  await assertExpectedCluster(repository, runner);
  await ensureNamespaces(repository, runner);
  const caRoot = await mkcertRoot(runner, options.platform ?? process.platform);
  await applyCaSecret(repository, runner, caRoot);
  await applyIssuer(repository, runner);
}

export async function removeLocalTrustArtifacts(
  repository: Repository,
): Promise<void> {
  await rm(join(tmpdir(), `kore-ca-${repository.environment.name}`), {
    recursive: true,
    force: true,
  });
}
