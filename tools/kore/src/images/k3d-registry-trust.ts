import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// Docs: docs/decisions/0084-k3d-registry-trust-through-a-mounted-ca-directory.md

/** Where the public CA is mounted inside every k3d node. */
export const nodeCaDirectory = "/etc/kore/registry-ca";
/** The CA file name, inside both the host directory and the node mount. */
export const registryCaFile = "ca.crt";
/** The path k3s reads its registry configuration from. */
export const nodeRegistriesFile = "/etc/rancher/k3s/registries.yaml";
export const registriesFileName = "registries.yaml";

/**
 * The host directory that holds the registry's public CA and the k3s registry
 * configuration for one k3d cluster. It is outside the repository and holds
 * only public material.
 */
export function k3dTrustDirectory(
  clusterName: string,
  home: string = homedir(),
): string {
  return join(home, ".kore", "k3d", clusterName, "registry-trust");
}

/**
 * The k3s registry configuration: nodes verify the registry's TLS against the
 * mounted CA. It names no mirror or endpoint, so no registry is added, and it
 * never skips verification.
 */
export function k3sRegistriesYaml(registryAddress: string): string {
  return [
    "configs:",
    `  ${JSON.stringify(registryAddress)}:`,
    "    tls:",
    `      ca_file: ${nodeCaDirectory}/${registryCaFile}`,
    "",
  ].join("\n");
}

/** Writes the k3s registry configuration the nodes mount; run before create. */
export async function writeK3dRegistriesConfig(
  directory: string,
  registryAddress: string,
): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, registriesFileName),
    k3sRegistriesYaml(registryAddress),
  );
}

/** Publishes the public CA to the nodes through the mounted directory. */
export async function writeK3dRegistryCa(
  directory: string,
  ca: string,
): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, registryCaFile), ca);
}

/** The `k3d cluster create` flags that mount the trust directory and registries.yaml. */
export function k3dTrustVolumeArgs(trustDirectory: string): string[] {
  return [
    "--volume",
    `${trustDirectory}:${nodeCaDirectory}@all`,
    "--volume",
    `${join(trustDirectory, registriesFileName)}:${nodeRegistriesFile}@all`,
  ];
}
