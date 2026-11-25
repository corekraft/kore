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

/** The environment with the flag set, and a feature lookup that reads the set flags as the code does. */
function environmentWith(flags: Record<string, boolean>): Environment {
  return {
    name: "local",
    features: flags,
  } as unknown as Environment;
}

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
  vi.mocked(readdir).mockResolvedValue(["api.json"] as never);
  vi.mocked(readFile).mockResolvedValue(JSON.stringify(suborg) as never);
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
