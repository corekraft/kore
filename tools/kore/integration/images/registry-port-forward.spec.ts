import { expect, test, vi } from "vitest";
import { localRegistryReference } from "../../src/images/index.js";
import type { Repository } from "../../src/config/index.js";
import type { Runner } from "../../src/runtime/index.js";
import { localPlatform } from "../local-platform-support.js";

const platform = await localPlatform();

// The registry units read only the repository's environment, so a fake carries
// those fields alone. The one cast stands in for the rest of the Repository type.
const repositoryWith = (fields: object): Repository => fields as Repository;

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

const noRunner: Runner = {
  run: () => Promise.reject(new Error("no command runs in this unit")),
};

test("a managed registry reference passes through without a local port forward", async () => {
  const reference = "registry.example.com/reference@sha256:" + "a".repeat(64);
  let started = false;

  await expect(
    localRegistryReference(
      repositoryWith({
        environment: { provider: "managed", kubeContext: "managed" },
      }),
      noRunner,
      reference,
      {
        spawnPortForward: () => {
          started = true;
          return 1;
        },
      },
    ),
  ).resolves.toBe(reference);
  expect(started).toBe(false);
  expect(spawnMock).not.toHaveBeenCalled();
});

test("a k3d environment with registry-by-name off is refused, naming the flag, and starts no port forward", async () => {
  let started = false;

  await expect(
    localRegistryReference(
      repositoryWith({
        name: "local",
        environment: {
          name: "local",
          provider: "k3d",
          kubeContext: "k3d-kore-local",
        },
      }),
      noRunner,
      `${platform.registryName}/reference:dev`,
      {
        spawnPortForward: () => {
          started = true;
          return 1;
        },
      },
    ),
  ).rejects.toThrow(
    "environment local reaches the local registry only by name, and registry-by-name is off; turn registry-by-name on in the environment's overlay, then run `kore local up`",
  );
  expect(started).toBe(false);
  expect(spawnMock).not.toHaveBeenCalled();
});
