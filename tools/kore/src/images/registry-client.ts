import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import type { RegistryCredential } from "./registry-auth.js";

// Docs: docs/decisions/0034-registry-authentication-and-authorization.md

export interface RegistryClient {
  /**
   * Variables to overlay on a child's environment (`{...base, ...client.env}`);
   * they hold the only copy of the secret.
   */
  env: NodeJS.ProcessEnv;
  /** Basic Authorization header for in-process registry requests. */
  authorization: string;
}

// The helper only answers `get`, from the child's environment. go-containerregistry
// (cosign) resolves it through the Docker config's credsStore, so the config
// file and this script hold no secret.
const helperScript = `#!/bin/sh
if [ "$1" != "get" ]; then
  echo "kore-env credential helper only supports get" >&2
  exit 1
fi
server=$(cat)
printf '{"ServerURL":"%s","Username":"%s","Secret":"%s"}' "$server" "$KORE_REGISTRY_USERNAME" "$KORE_REGISTRY_PASSWORD"
`;

/**
 * Gives a registry client the credential without a file or an argument. The
 * generated passwords are base64url, so the helper needs no JSON escaping.
 */
export async function withRegistryClient<T>(
  credential: RegistryCredential,
  action: (client: RegistryClient) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "kore-registry-"));
  try {
    await writeFile(
      join(directory, "config.json"),
      JSON.stringify({ credsStore: "kore-env" }),
      { mode: 0o600 },
    );
    const helper = join(directory, "docker-credential-kore-env");
    await writeFile(helper, helperScript, { mode: 0o700 });
    await chmod(helper, 0o700);
    return await action({
      env: {
        DOCKER_CONFIG: directory,
        PATH: `${directory}${delimiter}${process.env["PATH"] ?? ""}`,
        KORE_REGISTRY_USERNAME: credential.username,
        KORE_REGISTRY_PASSWORD: credential.password,
      },
      authorization: `Basic ${Buffer.from(`${credential.username}:${credential.password}`).toString("base64")}`,
    });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}
