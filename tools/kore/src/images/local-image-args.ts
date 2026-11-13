import { randomBytes } from "node:crypto";
import { join } from "node:path";

export function localDockerBuildArgs(
  applicationPath: string,
  tag: string,
): string[] {
  return [
    "build",
    "--file",
    join(applicationPath, "Dockerfile"),
    "--tag",
    tag,
    applicationPath,
  ];
}

/** Imports a locally built image into every node of a k3d cluster. */
export function k3dImageImportArgs(clusterName: string, tag: string): string[] {
  return ["image", "import", tag, "--cluster", clusterName];
}

/**
 * Runs registry commands through the k3d node's bundled containerd client
 * (ADR 0083). The caller supplies `${base64(user:password)}\n` as input. The
 * script reads that one line into a shell variable, writes a containerd
 * `hosts.toml` carrying it as an `Authorization` header into a directory on
 * memory-backed storage, and removes the directory on every exit, so the
 * credential is never in an argument or on a persistent disk. Commands refer
 * to that directory as "$d" through `--hosts-dir`.
 */
export function k3dRegistrySessionArgs(
  clusterName: string,
  registryAddress: string,
  caPem: string,
  commands: string[],
): string[] {
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]*(?::\d{1,5})?$/.test(registryAddress)) {
    throw new Error(
      `local registry has an invalid registry address "${registryAddress}"; it must be host[:port], so fix registry.address in the environment overlay`,
    );
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(clusterName)) {
    throw new Error(
      `k3d cluster name "${clusterName}" is invalid; environment.k3d.clusterName must be lowercase letters, digits and hyphens`,
    );
  }
  const hostsHead = [
    `server = "https://${registryAddress}"`,
    "",
    `[host."https://${registryAddress}"]`,
    `  capabilities = ["pull", "resolve", "push"]`,
    `  ca = "ca.crt"`,
    "",
    `  [host."https://${registryAddress}".header]`,
    `    Authorization = "Basic `,
  ].join("\n");
  const script = [
    "set -e",
    `[ -w /dev/shm ] || { echo "the k3d node has no writable /dev/shm for the registry credential" >&2; exit 1; }`,
    "d=$(mktemp -d -p /dev/shm)",
    `trap 'rm -rf "$d"' EXIT INT TERM HUP`,
    `mkdir -p "$d"/${shellQuote(registryAddress)}`,
    `printf '%s' ${shellQuote(Buffer.from(caPem).toString("base64"))} | base64 -d > "$d"/${shellQuote(`${registryAddress}/ca.crt`)}`,
    `IFS= read -r t && [ -n "$t" ] || { echo "no registry credential was supplied on stdin" >&2; exit 1; }`,
    `printf '%s%s"\\n' ${shellQuote(hostsHead)} "$t" > "$d"/${shellQuote(`${registryAddress}/hosts.toml`)}`,
    "unset t",
    ...commands,
  ].join("\n");
  return [
    "exec",
    "--interactive",
    `k3d-${clusterName}-server-0`,
    "sh",
    "-c",
    script,
  ];
}

export function k3dImagePublishArgs(
  clusterName: string,
  tag: string,
  registryAddress: string,
  repositoryPath: string,
  caPem: string,
): string[] {
  const destination = `${registryAddress}/${repositoryPath}`;
  const digestName = `${registryAddress}/${repositoryPath.replace(/:[^/:]+$/, "")}@`;
  return k3dRegistrySessionArgs(clusterName, registryAddress, caPem, [
    `ctr --namespace k8s.io images tag --force ${shellQuote(/^[^/]*[.:][^/]*\//.test(tag) ? tag : `docker.io/${tag}`)} ${shellQuote(destination)}`,
    `ctr --namespace k8s.io images push --hosts-dir "$d" ${shellQuote(destination)}`,
    // CRI synthesizes a digest name only for pulled images, so a digest
    // reference with pull policy Never needs its own name in the node.
    `g=$(ctr --namespace k8s.io images ls "name==${destination}" | awk 'NR==2{print $3}')`,
    `test -n "$g"`,
    `ctr --namespace k8s.io images tag --force ${shellQuote(destination)} "${digestName}$g"`,
  ]);
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function imageDigestFromRegistryHead(
  status: number,
  headers: string,
): string {
  if (status !== 200) {
    throw new Error(
      `local registry manifest lookup failed with HTTP ${status}`,
    );
  }
  const digests = [
    ...new Set(
      [
        ...headers.matchAll(
          /^docker-content-digest:\s*(sha256:[a-f0-9]{64})\s*$/gim,
        ),
      ].map((match) => match[1]),
    ),
  ];
  if (digests.length !== 1 || !digests[0]) {
    throw new Error(
      "local registry response did not include one valid manifest digest",
    );
  }
  return digests[0];
}

/**
 * Policy Controller 0.13 reads key signatures only from the legacy `.sig` tag
 * (its new-bundle path is keyless-only), and cosign 3 defaults to bundles, so
 * the legacy format is requested explicitly. A signing config cannot be
 * combined with it; the local flow has no transparency log anyway (ADR 0032).
 * The registry is TLS-only and cosign verifies it against its CA (ADR 0058).
 */
export function localSignArgs(
  key: string,
  reference: string,
  registryCaFile: string,
): string[] {
  return [
    "sign",
    "--key",
    key,
    "--new-bundle-format=false",
    "--use-signing-config=false",
    "--tlog-upload=false",
    "--registry-cacert",
    registryCaFile,
    "--yes",
    reference,
  ];
}

/** A tag of one build's own, so concurrent builds never share a mutable tag. */
export function newRunTag(): string {
  return `kore-local-${randomBytes(6).toString("hex")}`;
}
