// Docs: docs/decisions/0159-services-attach-to-the-platform-gateways-through-listener-sets-and-hostname-claims.md
import { beforeEach, expect, test, vi } from "vitest";
import { hostnameClaimErrors } from "./hostname-claims.js";
import { externalGateway } from "./gateways.js";
import { suborgRecords } from "./organization-records.js";
import { platformPlan } from "./platform-domain.js";
import {
  readReservedHostnames,
  reservedCoverageErrors,
} from "./reserved-hostnames.js";
import { reservedSuborgNames } from "./suborg-names.js";
import { hostnameFileErrors, type HostnameCheck } from "./hostname-check.js";
import type { Environment } from "./types.js";

vi.mock("./hostname-claims.js", () => ({ hostnameClaimErrors: vi.fn() }));
vi.mock("./gateways.js", () => ({ externalGateway: vi.fn() }));
vi.mock("./organization-records.js", () => ({ suborgRecords: vi.fn() }));
vi.mock("./platform-domain.js", () => ({ platformPlan: vi.fn() }));
vi.mock("./reserved-hostnames.js", () => ({
  readReservedHostnames: vi.fn(),
  reservedCoverageErrors: vi.fn(),
  reservedHostnamesPath: "infra/catalog/reserved-hostnames.json",
}));
vi.mock("./suborg-names.js", () => ({ reservedSuborgNames: vi.fn() }));

const environment = { name: "local" } as unknown as Environment;

const check: HostnameCheck = {
  root: "/repo",
  environment,
  catalogNamespaces: ["argocd"],
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(platformPlan).mockReturnValue({
    domain: "example.com",
    organizationId: "platform",
  });
  vi.mocked(externalGateway).mockReturnValue(undefined);
  vi.mocked(readReservedHostnames).mockResolvedValue({
    names: new Set(["www"]),
    errors: [],
  });
  vi.mocked(reservedCoverageErrors).mockReturnValue([]);
  vi.mocked(reservedSuborgNames).mockReturnValue(new Set(["argocd"]));
  vi.mocked(suborgRecords).mockResolvedValue([]);
  vi.mocked(hostnameClaimErrors).mockReturnValue([]);
});

test("the claim rules read the domain in force, and an internal domain of the platform domain with no external Gateway", async () => {
  await hostnameFileErrors(check, new Map());
  expect(hostnameClaimErrors).toHaveBeenCalledWith(
    expect.objectContaining({
      environment: {
        domain: "example.com",
        internalDomain: "example.com",
        externalGateway: false,
        placeholder: false,
      },
    }),
  );
});

test("with an external Gateway the internal domain is internal.<domain>, and the placeholder is named when it is in force", async () => {
  vi.mocked(externalGateway).mockReturnValue({} as never);
  vi.mocked(platformPlan).mockReturnValue({
    domain: "kore.internal",
    organizationId: "platform",
  });
  await hostnameFileErrors(check, new Map());
  expect(hostnameClaimErrors).toHaveBeenCalledWith(
    expect.objectContaining({
      environment: {
        domain: "kore.internal",
        internalDomain: "internal.kore.internal",
        externalGateway: true,
        placeholder: true,
      },
    }),
  );
});

test("each parsed spec becomes a claim, read from its spec fields and named by its service name", async () => {
  await hostnameFileErrors(
    check,
    new Map([
      [
        "leads",
        {
          file: "infra/environments/local/services/leads.json",
          manifest: {
            spec: {
              organization: "api",
              gateway: "external",
              hostnames: ["login.example.com"],
            },
          },
        },
      ],
      [
        "quotes",
        { file: "infra/environments/local/services/quotes.json", manifest: 42 },
      ],
    ]),
  );
  expect(hostnameClaimErrors).toHaveBeenCalledWith(
    expect.objectContaining({
      services: [
        {
          file: "infra/environments/local/services/leads.json",
          name: "leads",
          organization: "api",
          gateway: "external",
          hostnames: ["login.example.com"],
        },
        {
          file: "infra/environments/local/services/quotes.json",
          name: "quotes",
          organization: undefined,
          gateway: undefined,
          hostnames: undefined,
        },
      ],
    }),
  );
});

test("the reserved list's own errors come first, then its coverage of the app model, then the claim errors", async () => {
  vi.mocked(readReservedHostnames).mockResolvedValue({
    names: new Set(["www"]),
    errors: ["list-error"],
  });
  vi.mocked(reservedCoverageErrors).mockReturnValue(["coverage-error"]);
  vi.mocked(hostnameClaimErrors).mockReturnValue(["claim-error"]);
  expect(await hostnameFileErrors(check, new Map())).toEqual([
    "list-error",
    "coverage-error",
    "claim-error",
  ]);
});

test("the coverage check reads the app model's reserved suborg names from the catalog's namespaces", async () => {
  await hostnameFileErrors(check, new Map());
  expect(reservedSuborgNames).toHaveBeenCalledWith(["argocd"]);
  expect(reservedCoverageErrors).toHaveBeenCalledWith(
    "infra/catalog/reserved-hostnames.json",
    new Set(["www"]),
    ["argocd"],
  );
});
