// Docs: docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md
import { beforeEach, expect, test, vi } from "vitest";
import { k3dClusterInfo } from "../cluster/index.js";
import { resolverChecks, systemResolverHost } from "../resolver/index.js";
import { doctor, type Check } from "./doctor.js";
import { fakeRepository, fakeRunner } from "./diagnostics-support.js";
import { registryNameCheck } from "./registry-name-check.js";

vi.mock("../cluster/index.js", () => ({ k3dClusterInfo: vi.fn() }));
vi.mock("../config/index.js", () => ({ managedCluster: vi.fn() }));
vi.mock("../resolver/index.js", () => ({
  resolverChecks: vi.fn(),
  systemResolverHost: vi.fn(),
}));
vi.mock("./registry-name-check.js", () => ({ registryNameCheck: vi.fn() }));

const finding: Check = {
  name: "registry:name",
  status: "warn",
  required: false,
  message: "registry.platform.kore.internal does not resolve (ENOTFOUND)",
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(k3dClusterInfo).mockResolvedValue({
    state: "running",
  } as Awaited<ReturnType<typeof k3dClusterInfo>>);
  vi.mocked(resolverChecks).mockResolvedValue([]);
  vi.mocked(systemResolverHost).mockReturnValue({} as never);
  vi.mocked(registryNameCheck).mockResolvedValue([finding]);
});

test("doctor ends with the registry name check, which reads the repository and runner it was given", async () => {
  const repository = fakeRepository();
  const { runner } = fakeRunner();

  const checks = await doctor(repository, runner);

  expect(checks.at(-1)).toEqual(finding);
  expect(registryNameCheck).toHaveBeenCalledExactlyOnceWith(repository, runner);
});

test("a registry name warning never fails doctor, whatever the probe found", async () => {
  const checks = await doctor(fakeRepository(), fakeRunner().runner);

  expect(checks.filter((check) => check.name === "registry:name")).toEqual([
    finding,
  ]);
  expect(
    checks.some((check) => check.required && check.status === "fail"),
  ).toBe(false);
});
