// Docs: docs/decisions/0031-registry-address-platform-variable.md
import { beforeEach, expect, test, vi } from "vitest";
import { fakeEnvironment, fakeRepository } from "./config-support.js";
import { environmentFieldErrors } from "./environment-errors.js";
import { gatewayErrors } from "./gateways.js";
import { platformDomainErrors } from "./platform-domain.js";
import { registryAddressErrors } from "./registry-address.js";

vi.mock("./gateways.js", () => ({ gatewayErrors: vi.fn() }));
vi.mock("./platform-domain.js", () => ({ platformDomainErrors: vi.fn() }));
vi.mock("./registry-address.js", () => ({ registryAddressErrors: vi.fn() }));

const environment = fakeEnvironment();
const repository = fakeRepository({ environment });

beforeEach(() => {
  vi.mocked(registryAddressErrors).mockReturnValue([]);
  vi.mocked(platformDomainErrors).mockReturnValue([]);
  vi.mocked(gatewayErrors).mockReturnValue([]);
});

test("an environment whose one-place fields are sound reports nothing", () => {
  expect(environmentFieldErrors(repository)).toEqual([]);
});

test("the registry address, the platform field and the Gateways are each checked once, against the repository and its environment", () => {
  environmentFieldErrors(repository);
  expect(vi.mocked(registryAddressErrors).mock.calls).toEqual([[repository]]);
  expect(vi.mocked(platformDomainErrors).mock.calls).toEqual([[environment]]);
  expect(vi.mocked(gatewayErrors).mock.calls).toEqual([[environment]]);
});

test("the field errors and the Gateway errors are reported together, so one run names every bad value", () => {
  vi.mocked(registryAddressErrors).mockReturnValue(["registry.address bad"]);
  vi.mocked(platformDomainErrors).mockReturnValue(["platform.domain bad"]);
  vi.mocked(gatewayErrors).mockReturnValue(["gateways.internal is required"]);
  expect(environmentFieldErrors(repository)).toEqual([
    "registry.address bad",
    "platform.domain bad",
    "gateways.internal is required",
  ]);
});
