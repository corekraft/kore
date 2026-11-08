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

export function minikubeImagePublishArgs(
  profile: string,
  tag: string,
  registryAddress: string,
  repositoryPath: string,
): string[] {
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]*(?::\d{1,5})?$/.test(registryAddress)) {
    throw new Error(`local registry has an invalid registry address`);
  }
  const destination = `${registryAddress}/${repositoryPath}`;
  return [
    "ssh",
    "--profile",
    profile,
    "--",
    `sudo nerdctl --namespace k8s.io tag '${tag}' '${destination}' && sudo nerdctl --insecure-registry --namespace k8s.io push '${destination}'`,
  ];
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

export function localSigningConfigArgs(path: string): string[] {
  return [
    "signing-config",
    "create",
    "--with-default-services",
    "--no-default-rekor",
    "--no-default-tsa",
    "--out",
    path,
  ];
}
