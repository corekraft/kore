// Docs: docs/decisions/0056-platform-image-inventory.md (audit before enforce)
import { beforeEach, expect, test, vi } from "vitest";
import { catalogErrors } from "./catalog-errors.js";
import { k3dErrors } from "./k3d-errors.js";
import { imageListErrors } from "./approved.js";
import { overlayErrors, overlayWarnings } from "./overlay-errors.js";
import { orderedComponents, readinessErrors } from "./order.js";
import { policyErrors } from "./policy-validation.js";
import { registryAddressErrors } from "./registry-address.js";
import { exemptionCheckMode, validateRepository } from "./validate.js";
import {
  fakeCatalog,
  fakeComponent,
  fakeEnvironment,
  fakeRepository,
  fakeVersions,
  malformed,
} from "./config-support.js";
import type { Environment } from "./types.js";

// Factories, not automocks: the collaborators' real modules never load here.
vi.mock("./approved.js", () => ({ imageListErrors: vi.fn() }));
vi.mock("./catalog-errors.js", () => ({ catalogErrors: vi.fn() }));
vi.mock("./k3d-errors.js", () => ({ k3dErrors: vi.fn() }));
vi.mock("./order.js", () => ({
  orderedComponents: vi.fn(),
  readinessErrors: vi.fn(),
}));
vi.mock("./overlay-errors.js", () => ({
  overlayErrors: vi.fn(),
  overlayWarnings: vi.fn(),
}));
vi.mock("./policy-validation.js", () => ({ policyErrors: vi.fn() }));
vi.mock("./registry-address.js", () => ({ registryAddressErrors: vi.fn() }));

function repositoryWith(environment: Partial<Environment> = {}) {
  return fakeRepository({
    versions: fakeVersions({ istio: "1.23.0" }, {}),
    catalog: fakeCatalog([fakeComponent()]),
    environment: fakeEnvironment(environment),
  });
}

beforeEach(() => {
  vi.mocked(catalogErrors).mockReturnValue([]);
  vi.mocked(k3dErrors).mockReturnValue([]);
  vi.mocked(overlayErrors).mockResolvedValue([]);
  vi.mocked(overlayWarnings).mockReturnValue([]);
  vi.mocked(imageListErrors).mockResolvedValue([]);
  vi.mocked(policyErrors).mockResolvedValue([]);
  vi.mocked(readinessErrors).mockReturnValue([]);
  vi.mocked(registryAddressErrors).mockReturnValue([]);
  vi.mocked(orderedComponents).mockReturnValue([]);
});

test("a source that returns only warnings leaves validation passing, and the warnings come back sorted and de-duplicated", async () => {
  const source = vi
    .fn()
    .mockResolvedValue(["b: stale", "a: loose", "b: stale"]);
  const repository = repositoryWith();
  expect(await validateRepository(repository, [source])).toEqual([
    "a: loose",
    "b: stale",
  ]);
  expect(source).toHaveBeenCalledWith(repository);
});

test("validation without a warning source returns no warnings", async () => {
  expect(await validateRepository(repositoryWith())).toEqual([]);
});

test("errors still fail with only the errors in the message, warnings left out", async () => {
  vi.mocked(k3dErrors).mockReturnValue(["k3d: bad cluster"]);
  const source = vi.fn().mockResolvedValue(["a: loose"]);
  await expect(validateRepository(repositoryWith(), [source])).rejects.toThrow(
    new Error("k3d: bad cluster"),
  );
});

test("environment.exemptionCheck accepts audit and enforce and rejects any other value", async () => {
  for (const mode of ["audit", "enforce"] as const) {
    await expect(
      validateRepository(repositoryWith({ exemptionCheck: mode })),
    ).resolves.toEqual([]);
  }
  await expect(
    validateRepository(
      repositoryWith({
        exemptionCheck: malformed<"audit">("warn"),
      }),
    ),
  ).rejects.toThrow(
    new Error("environment.exemptionCheck must be audit or enforce"),
  );
});

test("an unset exemptionCheck reads as audit", () => {
  expect(exemptionCheckMode(fakeEnvironment())).toBe("audit");
  expect(
    exemptionCheckMode(fakeEnvironment({ exemptionCheck: "enforce" })),
  ).toBe("enforce");
});

test("exemption findings warn under audit and never fail validation", async () => {
  const exemptions = vi.fn().mockResolvedValue(["exemption: x is unlisted"]);
  expect(
    await validateRepository(
      repositoryWith({ exemptionCheck: "audit" }),
      [],
      exemptions,
    ),
  ).toEqual(["exemption: x is unlisted"]);
});

test("exemption findings warn when exemptionCheck is unset", async () => {
  const exemptions = vi.fn().mockResolvedValue(["exemption: x is unlisted"]);
  expect(await validateRepository(repositoryWith(), [], exemptions)).toEqual([
    "exemption: x is unlisted",
  ]);
});

test("exemption findings fail validation under enforce", async () => {
  const exemptions = vi.fn().mockResolvedValue(["exemption: x is unlisted"]);
  await expect(
    validateRepository(
      repositoryWith({ exemptionCheck: "enforce" }),
      [],
      exemptions,
    ),
  ).rejects.toThrow(new Error("exemption: x is unlisted"));
});

test("the exemption source is not read when another rule fails, so its errors never mask them", async () => {
  vi.mocked(k3dErrors).mockReturnValue(["k3d: bad cluster"]);
  const exemptions = vi
    .fn()
    .mockRejectedValue(new Error("exemption check: dir does not exist"));
  await expect(
    validateRepository(repositoryWith(), [], exemptions),
  ).rejects.toThrow(new Error("k3d: bad cluster"));
  expect(exemptions).not.toHaveBeenCalled();
});

test("the overlay's warnings join the reported warnings and never fail validation", async () => {
  vi.mocked(overlayWarnings).mockReturnValue(["alerts have no contact point"]);
  expect(await validateRepository(repositoryWith())).toEqual([
    "alerts have no contact point",
  ]);
});
