// Docs: docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md
import { beforeEach, expect, test, vi } from "vitest";
import { registryByName, registryHostname } from "../config/index.js";
import { registryNameProblem } from "../images/index.js";
import { fakeRepository, fakeRunner } from "./diagnostics-support.js";
import { registryNameCheck } from "./registry-name-check.js";

vi.mock("../config/index.js", () => ({
  registryByName: vi.fn(),
  registryHostname: vi.fn(),
}));
vi.mock("../images/index.js", () => ({ registryNameProblem: vi.fn() }));

const name = "registry.platform.kore.internal";

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(registryByName).mockReturnValue(true);
  vi.mocked(registryHostname).mockReturnValue(name);
});

test("with registry-by-name off there is no registry name check and nothing is probed", async () => {
  vi.mocked(registryByName).mockReturnValue(false);
  const { runner, run } = fakeRunner();

  await expect(registryNameCheck(fakeRepository(), runner)).resolves.toEqual(
    [],
  );
  expect(registryNameProblem).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});

test("a reachable registry name passes, as an optional check", async () => {
  vi.mocked(registryNameProblem).mockResolvedValue(undefined);

  await expect(
    registryNameCheck(fakeRepository(), fakeRunner().runner),
  ).resolves.toEqual([
    {
      name: "registry:name",
      status: "pass",
      required: false,
      message: `${name} answers /v2/ with the registry's own certificate`,
    },
  ]);
});

test("a registry name that cannot be reached warns with the cause the probe named, and never fails doctor", async () => {
  vi.mocked(registryNameProblem).mockResolvedValue(
    `${name} does not resolve (ENOTFOUND); turn on platform-dns`,
  );

  await expect(
    registryNameCheck(fakeRepository(), fakeRunner().runner),
  ).resolves.toEqual([
    {
      name: "registry:name",
      status: "warn",
      required: false,
      message: `${name} does not resolve (ENOTFOUND); turn on platform-dns`,
    },
  ]);
});

test("a registry CA that cannot be read is a warning carrying its message, so doctor still reports the rest", async () => {
  vi.mocked(registryNameProblem).mockRejectedValue(
    new Error("the internal registry's CA is missing"),
  );

  await expect(
    registryNameCheck(fakeRepository(), fakeRunner().runner),
  ).resolves.toEqual([
    {
      name: "registry:name",
      status: "warn",
      required: false,
      message: "the internal registry's CA is missing",
    },
  ]);
});
