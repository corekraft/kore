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

export function minikubeImageLoadArgs(profile: string, tag: string): string[] {
  return ["image", "load", "--profile", profile, "--daemon", tag];
}

/**
 * Runs registry commands inside the node. The password is read from stdin by
 * one line of stdin and piped to `nerdctl login --password-stdin`, which
 * writes a Docker config on memory-backed
 * storage that the script removes on exit, so it is never in an argument or on
 * a persistent disk (ADR 0034). The caller supplies `${password}\n` as input.
 */
export function minikubeRegistrySessionArgs(
  profile: string,
  registryAddress: string,
  username: string,
  commands: string[],
): string[] {
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]*(?::\d{1,5})?$/.test(registryAddress)) {
    throw new Error(`local registry has an invalid registry address`);
  }
  if (!/^[a-z][a-z0-9-]*$/.test(username)) {
    throw new Error(`local registry has an invalid username`);
  }
  const script = [
    "set -e",
    "d=$(mktemp -d -p /dev/shm)",
    `trap 'rm -rf "$d"' EXIT`,
    'export DOCKER_CONFIG="$d"',
    // Read exactly one line: minikube's native SSH client never closes stdin,
    // so a login that reads to end of input would hang forever.
    "IFS= read -r p",
    `printf '%s' "$p" | nerdctl login --username ${shellQuote(username)} --password-stdin ${shellQuote(registryAddress)} >/dev/null`,
    "unset p",
    ...commands,
  ].join("\n");
  // The native Go SSH client allocates a terminal that echoes stdin (the
  // password) into the captured output, and never closes stdin; the external
  // ssh client does neither.
  return [
    "ssh",
    "--profile",
    profile,
    "--native-ssh=false",
    "--",
    `sudo sh -c ${shellQuote(script)}`,
  ];
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function minikubeImagePublishArgs(
  profile: string,
  tag: string,
  registryAddress: string,
  repositoryPath: string,
  username: string,
): string[] {
  const destination = `${registryAddress}/${repositoryPath}`;
  return minikubeRegistrySessionArgs(profile, registryAddress, username, [
    `nerdctl --namespace k8s.io tag ${shellQuote(tag)} ${shellQuote(destination)}`,
    `nerdctl --namespace k8s.io push ${shellQuote(destination)}`,
  ]);
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

/**
 * Installs the registry CA for containerd and nerdctl on the node (ADR 0058).
 * containerd reads `certs.d/<address>/hosts.toml` on every pull, so no restart
 * is needed. The certificate is public, so it travels in the command, base64
 * encoded; rewriting identical files is harmless.
 */
export function minikubeCaTrustArgs(
  profile: string,
  registryAddress: string,
  caPem: string,
): string[] {
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]*(?::\d{1,5})?$/.test(registryAddress)) {
    throw new Error(`local registry has an invalid registry address`);
  }
  const directory = `/etc/containerd/certs.d/${registryAddress}`;
  const hosts = [
    `server = "https://${registryAddress}"`,
    "",
    `[host."https://${registryAddress}"]`,
    `  capabilities = ["pull", "resolve", "push"]`,
    `  ca = "ca.crt"`,
    "",
  ].join("\n");
  const script = [
    "set -e",
    `mkdir -p ${shellQuote(directory)}`,
    `printf '%s' ${shellQuote(Buffer.from(caPem).toString("base64"))} | base64 -d > ${shellQuote(`${directory}/ca.crt`)}`,
    `printf '%s' ${shellQuote(hosts)} > ${shellQuote(`${directory}/hosts.toml`)}`,
  ].join("\n");
  return [
    "ssh",
    "--profile",
    profile,
    "--",
    `sudo sh -c ${shellQuote(script)}`,
  ];
}
