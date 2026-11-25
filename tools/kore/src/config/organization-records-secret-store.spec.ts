// Docs: docs/decisions/0167-application-secrets-come-from-openbao-behind-the-platform-secrets-contract-one-path-per-suborg.md
import { readdir, readFile } from "node:fs/promises";
import { beforeEach, expect, test, vi } from "vitest";
import {
  checkOrganizationRecords,
  organizationRecordErrors,
} from "./organization-records.js";
import { suborgInternalZoneErrors } from "./internal-zone.js";
import { platformClaimErrors } from "./platform-claims.js";
import { platformPlan } from "./platform-domain.js";
import {
  reservedNameErrors,
  reservedSuborgNames,
  secretStoreNameErrors,
  suborgDefaultZone,
  suborgSecretStoreOn,
} from "./suborg-names.js";
import type { Environment } from "./types.js";

// Issue 1555: with suborg-secret-store on, a suborg name must also fit the source namespace its
// store reads, so the record check consults the store's name rule; with the flag off it never does.

vi.mock("node:fs/promises");
vi.mock("./internal-zone.js");
vi.mock("./platform-claims.js");
vi.mock("./platform-domain.js");
vi.mock("./suborg-names.js");

const root = "/repo";
const file = "infra/environments/local/organizations/api.json";
const reserved: ReadonlySet<string> = new Set(["argocd"]);

const suborg = {
  apiVersion: "platform.kore.dev/v1alpha1",
  kind: "Organization",
  metadata: { name: "api" },
  spec: {
    tenant: "platform",
    parent: "platform",
    quota: {
      requests: { cpu: "8", memory: "16Gi" },
      pods: 50,
      storage: "100Gi",
    },
  },
};

/** The local environment with the given feature flags set. */
function environmentWith(flags: Record<string, boolean>): Environment {
  return {
    name: "local",
    provider: "k3d",
    kubeContext: "k3d-kore-local",
    registry: { address: "registry.kore.internal:5000" },
    features: flags,
    platform: { domain: "kore.internal", organizationId: "org-1" },
    secrets: {
      storeName: "platform-secrets",
      sourceNamespace: "kore-secret-source",
    },
    telemetry: { otlpEndpoint: "http://otel-collector:4317" },
  };
}

/** The directory listing and the text read, typed by the overloads the record check calls. */
const listNames: (path: string) => Promise<string[]> = readdir;
const readText: (path: string, encoding: "utf8") => Promise<string> = readFile;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(platformClaimErrors).mockReturnValue([]);
  vi.mocked(suborgInternalZoneErrors).mockReturnValue([]);
  vi.mocked(reservedNameErrors).mockReturnValue([]);
  vi.mocked(secretStoreNameErrors).mockReturnValue([]);
  vi.mocked(reservedSuborgNames).mockReturnValue(reserved);
  vi.mocked(platformPlan).mockReturnValue({
    domain: "kore.internal",
    organizationId: "org-1",
  });
  vi.mocked(suborgDefaultZone).mockReturnValue("api.kore.internal");
  vi.mocked(suborgSecretStoreOn).mockImplementation(
    (environment) => environment.features?.["suborg-secret-store"] === true,
  );
});

test("with suborg-secret-store on, the record check holds the suborg name to the store's rule and reports the refusal it returns", () => {
  vi.mocked(secretStoreNameErrors).mockReturnValue([
    "store-name refusal from the store's rule",
  ]);
  expect(
    organizationRecordErrors({
      file,
      stem: "api",
      manifest: suborg,
      suborgs: new Set(),
      reserved,
      secretStore: true,
    }),
  ).toEqual(["store-name refusal from the store's rule"]);
  expect(secretStoreNameErrors).toHaveBeenCalledWith("api", file);
});

test("with suborg-secret-store off, the record check never consults the store's rule, so the suborg name is judged as before", () => {
  expect(
    organizationRecordErrors({
      file,
      stem: "api",
      manifest: suborg,
      suborgs: new Set(),
      reserved,
      secretStore: false,
    }),
  ).toEqual([]);
  expect(secretStoreNameErrors).not.toHaveBeenCalled();
});

test("the environment's check consults the store's rule only while the environment turns suborg-secret-store on", async () => {
  vi.mocked(listNames).mockResolvedValue(["api.json"]);
  vi.mocked(readText).mockResolvedValue(JSON.stringify(suborg));
  const checkEnvironment = (environment: Environment) =>
    checkOrganizationRecords({
      root,
      environment,
      catalogNamespaces: ["argocd"],
    });

  await checkEnvironment(environmentWith({ "suborg-secret-store": true }));
  expect(secretStoreNameErrors).toHaveBeenCalledWith("api", file);

  vi.mocked(secretStoreNameErrors).mockClear();
  await checkEnvironment(environmentWith({ "suborg-secret-store": false }));
  expect(secretStoreNameErrors).not.toHaveBeenCalled();
});
