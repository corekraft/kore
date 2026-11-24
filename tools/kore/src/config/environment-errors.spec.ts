// Docs: docs/decisions/0031-registry-address-platform-variable.md
import { beforeEach, expect, test, vi } from "vitest";
import { fakeEnvironment, fakeRepository } from "./config-support.js";
import { acmeDns01Errors } from "./acme-dns01.js";
import { acmeIssuersErrors } from "./acme-issuers.js";
import { environmentFieldErrors } from "./environment-errors.js";
import { gatewayErrors } from "./gateways.js";
import { nodeCapacityErrors } from "./node-capacity.js";
import { platformDomainErrors } from "./platform-domain.js";
import { registryAddressErrors } from "./registry-address.js";

vi.mock("./acme-dns01.js", () => ({ acmeDns01Errors: vi.fn() }));
vi.mock("./acme-issuers.js", () => ({ acmeIssuersErrors: vi.fn() }));
vi.mock("./gateways.js", () => ({ gatewayErrors: vi.fn() }));
vi.mock("./node-capacity.js", () => ({ nodeCapacityErrors: vi.fn() }));
vi.mock("./platform-domain.js", () => ({ platformDomainErrors: vi.fn() }));
vi.mock("./registry-address.js", () => ({ registryAddressErrors: vi.fn() }));

const environment = fakeEnvironment();
const repository = fakeRepository({ environment });

beforeEach(() => {
  vi.mocked(registryAddressErrors).mockReturnValue([]);
  vi.mocked(platformDomainErrors).mockReturnValue([]);
  vi.mocked(gatewayErrors).mockReturnValue([]);
  vi.mocked(nodeCapacityErrors).mockReturnValue([]);
  vi.mocked(acmeDns01Errors).mockReturnValue([]);
  vi.mocked(acmeIssuersErrors).mockReturnValue([]);
});

test("the node count, committed fraction and reserves are checked once, against the environment, and their errors join the field errors", () => {
  vi.mocked(nodeCapacityErrors).mockReturnValue(["environment.nodeCount bad"]);
  expect(environmentFieldErrors(repository)).toEqual([
    "environment.nodeCount bad",
  ]);
  expect(vi.mocked(nodeCapacityErrors).mock.calls).toEqual([[environment]]);
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

test("the acme-dns01 placeholder refusal is checked against the environment and its error joins the field errors", () => {
  vi.mocked(acmeDns01Errors).mockReturnValue(["acme-dns01 needs the domain"]);
  expect(environmentFieldErrors(repository)).toEqual([
    "acme-dns01 needs the domain",
  ]);
  expect(vi.mocked(acmeDns01Errors).mock.calls).toEqual([
    [environment, process.env],
  ]);
});

test("the acme-issuers placeholder refusal is checked against the environment and its error joins the field errors", () => {
  vi.mocked(acmeIssuersErrors).mockReturnValue([
    "acme-issuers needs the domain",
  ]);
  expect(environmentFieldErrors(repository)).toEqual([
    "acme-issuers needs the domain",
  ]);
  expect(vi.mocked(acmeIssuersErrors).mock.calls).toEqual([
    [environment, process.env],
  ]);
});
