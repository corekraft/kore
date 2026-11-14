// Default answers for the install unit's collaborators: a local cluster with a
// registry the kore-managed credential serves, and a chart fingerprint that
// differs from what Helm recorded. A test overrides only the answer it tests.
import { vi } from "vitest";
import {
  koreManagesRegistryAuth,
  loadRegistryCredential,
  registryAddress,
  registryPullSecret,
  type RegistryCredential,
} from "../images/index.js";
import {
  argsFingerprint,
  releaseMatchesFingerprint,
} from "../platform/index.js";
import { access } from "node:fs/promises";
import { join, relative } from "node:path";
import { releaseArgs } from "./release.js";

export function installDefaults(): void {
  vi.mocked(join).mockImplementation((...parts: string[]) => parts.join("/"));
  vi.mocked(relative).mockImplementation((from, to) =>
    to.replace(`${from}/`, ""),
  );
  vi.mocked(access).mockResolvedValue(undefined);
  vi.mocked(koreManagesRegistryAuth).mockReturnValue(true);
  vi.mocked(loadRegistryCredential).mockResolvedValue({
    username: "kore-read",
  } as RegistryCredential);
  vi.mocked(registryAddress).mockReturnValue("registry.kore.local:30500");
  vi.mocked(registryPullSecret).mockReturnValue({
    metadata: { name: "kore-registry-pull" },
  } as ReturnType<typeof registryPullSecret>);
  vi.mocked(releaseArgs).mockImplementation(
    (_repo, _name, release, chartPath) => ["upgrade", release, chartPath],
  );
  vi.mocked(argsFingerprint).mockReturnValue("fp-1");
  vi.mocked(releaseMatchesFingerprint).mockResolvedValue(false);
}
