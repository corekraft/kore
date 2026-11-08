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
 * `nerdctl login --password-stdin` into a Docker config on memory-backed
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
    `nerdctl --insecure-registry login --username ${shellQuote(username)} --password-stdin ${shellQuote(registryAddress)} >/dev/null`,
    ...commands,
  ].join("\n");
  return [
    "ssh",
    "--profile",
    profile,
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
    `nerdctl --insecure-registry --namespace k8s.io push ${shellQuote(destination)}`,
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
 */
export function localSignArgs(key: string, reference: string): string[] {
  return [
    "sign",
    "--key",
    key,
    "--new-bundle-format=false",
    "--use-signing-config=false",
    "--tlog-upload=false",
    "--allow-http-registry",
    "--yes",
    reference,
  ];
}
