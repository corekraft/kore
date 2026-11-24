// Docs: docs/decisions/0164-the-platform-domain-is-a-run-time-value-and-the-repository-holds-a-placeholder.md
import { expect, test, vi } from "vitest";
import { doctor } from "./doctor.js";
import { fakeRepository, fakeRunner } from "./diagnostics-support.js";
import { runTimeChecks } from "./run-time-check.js";

// Factories name only what doctor reads on a local k3d overlay, so no probe runs.
vi.mock("../cluster/index.js", () => ({
  k3dClusterInfo: async () => ({ state: "running" }),
}));
vi.mock("../config/index.js", () => ({ managedCluster: vi.fn() }));
vi.mock("./token-secret-check.js", () => ({
  tokenSecretChecks: async () => [],
}));
vi.mock("./registry-name-check.js", () => ({
  registryNameCheck: async () => [],
}));
vi.mock("../resolver/index.js", () => ({
  resolverChecks: async () => [],
  systemResolverHost: () => ({}),
}));
vi.mock("./run-time-check.js", () => ({ runTimeChecks: vi.fn() }));

test("doctor appends the run-time checks after the registry name check, reading the environment it is given and the machine's home", async () => {
  const finding = {
    name: "platform-domain",
    status: "pass" as const,
    required: false as const,
    message: "set: the local platform domain is in the environment overlay",
  };
  vi.mocked(runTimeChecks).mockResolvedValue([finding]);
  const repository = fakeRepository();
  const environment = { KORE_PLATFORM_DOMAIN: "example.com" };
  const { runner } = fakeRunner();

  const checks = await doctor(repository, runner, environment, "/home/owner");

  expect(checks.at(-1)).toEqual(finding);
  expect(runTimeChecks).toHaveBeenCalledWith(
    repository.environment,
    environment,
    "/home/owner",
  );
});
