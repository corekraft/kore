// Docs: docs/decisions/0165-a-suborg-is-the-namespace-quota-and-trust-boundary-of-its-services.md
import { readdir, readFile } from "node:fs/promises";
import { beforeEach, expect, test, vi } from "vitest";
import {
  checkOrganizationRecords,
  organizationRecordErrors,
  suborgNames,
} from "./organization-records.js";
import { suborgInternalZoneErrors } from "./internal-zone.js";
import { platformClaimErrors } from "./platform-claims.js";
import { platformPlan } from "./platform-domain.js";
import {
  reservedNameErrors,
  reservedSuborgNames,
  suborgDefaultZone,
} from "./suborg-names.js";
import type { Environment } from "./types.js";

vi.mock("node:fs/promises");
vi.mock("./internal-zone.js");
vi.mock("./platform-claims.js");
vi.mock("./platform-domain.js");
vi.mock("./suborg-names.js");

const root = "/repo";
const dir = `${root}/infra/environments/local/organizations`;
const file = "infra/environments/local/organizations/api.json";
const reserved: ReadonlySet<string> = new Set(["argocd", "keycloak"]);
const environment = { name: "local" } as Environment;

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

const nonRootParent = `claims[0].spec.parent: must be "platform", the tenant root: v1 places a suborg one level below it; set it to "platform"`;
const nonRootParentAtFile = `${file}.spec.parent: must be "platform", the tenant root: v1 places a suborg one level below it; set it to "platform"`;

function check(
  manifest: unknown,
  stem = "api",
  suborgs: readonly string[] = [],
): string[] {
  return organizationRecordErrors({
    file,
    stem,
    manifest,
    suborgs: new Set(suborgs),
    reserved,
  });
}

/** A path argument as a string; the mocks only ever receive strings. */
const pathKey = (path: unknown): string =>
  typeof path === "string" ? path : "";

/** The suborg directory holds these files, each read by its name. */
function directory(records: Record<string, string>): void {
  vi.mocked(readdir).mockResolvedValue(Object.keys(records) as never);
  vi.mocked(readFile).mockImplementation(
    async (path) => records[pathKey(path).slice(dir.length + 1)] as never,
  );
}

function report() {
  return checkOrganizationRecords({
    root,
    environment,
    catalogNamespaces: ["argocd", "keycloak"],
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(platformClaimErrors).mockReturnValue([]);
  vi.mocked(suborgInternalZoneErrors).mockReturnValue([]);
  vi.mocked(reservedNameErrors).mockReturnValue([]);
  vi.mocked(reservedSuborgNames).mockReturnValue(reserved);
  vi.mocked(platformPlan).mockReturnValue({
    domain: "kore.internal",
    organizationId: "org-1",
  });
  vi.mocked(suborgDefaultZone).mockReturnValue("api.kore.internal");
});

test("a suborg that the claim rules and the reserved-name rule accept has no errors", () => {
  expect(check(suborg)).toEqual([]);
  expect(platformClaimErrors).toHaveBeenCalledWith([suborg]);
  expect(reservedNameErrors).toHaveBeenCalledWith("api", file, reserved);
});

test("a record that is not an Organization is refused, naming the kind it must be, and the claim rules never see it", () => {
  expect(check({ ...suborg, kind: "Service" })).toEqual([
    `${file}.kind: must be Organization, the kind of a suborg record; a Service belongs in the services directory`,
  ]);
  expect(platformClaimErrors).not.toHaveBeenCalled();
});

test("a kind that is neither Organization nor Service is refused without the Service hint", () => {
  expect(check({ ...suborg, kind: "Namespace" })).toEqual([
    `${file}.kind: must be Organization, the kind of a suborg record`,
  ]);
});

test("a record that is not an object is refused as not an Organization object", () => {
  expect(check("api")).toEqual([
    `${file}: the record must be an Organization object with apiVersion, kind and metadata.name`,
  ]);
});

test("the platform organization is the chart's, so a platform record in this directory is refused", () => {
  expect(
    check({ ...suborg, metadata: { name: "platform" } }, "platform"),
  ).toEqual([
    `${file}: the platform organization is defined by the platform chart, not an overlay; this directory holds suborgs only`,
  ]);
  expect(platformClaimErrors).not.toHaveBeenCalled();
});

test("a metadata.name that is not the file name stem names both and the fix", () => {
  expect(check(suborg, "payments")).toEqual([
    `${file}: metadata.name "api" must equal the file name "payments" without .json; rename the file or the name`,
  ]);
  expect(platformClaimErrors).not.toHaveBeenCalled();
});

test.each([
  [
    "a missing quota",
    `claims[0].spec.quota: is required for a suborg, and has no default: set requests.cpu, requests.memory, pods and storage`,
    `${file}.spec.quota: is required for a suborg, and has no default: set requests.cpu, requests.memory, pods and storage`,
  ],
  [
    "a double hyphen in the name",
    `claims[0].metadata.name: must not contain a double hyphen: the suborg namespace is <suborg> and its preview is <suborg>--preview; rename it, for example "api-v2"`,
    `${file}.metadata.name: must not contain a double hyphen: the suborg namespace is <suborg> and its preview is <suborg>--preview; rename it, for example "api-v2"`,
  ],
  [
    "a name of 55 characters",
    `claims[0].metadata.name: must be at most 54 characters, so <suborg>--preview fits 63; shorten it, for example "${"a".repeat(54)}"`,
    `${file}.metadata.name: must be at most 54 characters, so <suborg>--preview fits 63; shorten it, for example "${"a".repeat(54)}"`,
  ],
])(
  "%s, reported by the claim rules, is reported under the record's file path",
  (_behaviour, claimError, expected) => {
    vi.mocked(platformClaimErrors).mockReturnValue([claimError]);
    expect(check(suborg)).toEqual([expected]);
  },
);

test("a reserved name is reported by the reserved-name rule under the record's file path", () => {
  const message = `${file}.metadata.name: "keycloak" is a reserved name: it is a platform namespace, default, internal, www or reference; choose another name, for example "keycloak-team"`;
  vi.mocked(reservedNameErrors).mockReturnValue([message]);
  expect(
    check({ ...suborg, metadata: { name: "keycloak" } }, "keycloak"),
  ).toEqual([message]);
  expect(reservedNameErrors).toHaveBeenCalledWith("keycloak", file, reserved);
});

test("a parent that is another suborg of this environment is depth two, and the depth message replaces the non-root message", () => {
  vi.mocked(platformClaimErrors).mockReturnValue([nonRootParent]);
  const manifest = {
    ...suborg,
    metadata: { name: "leads" },
    spec: { ...suborg.spec, parent: "api" },
  };
  expect(check(manifest, "leads", ["api", "leads"])).toEqual([
    `${file}.spec.parent: "api" is a suborg, so this suborg would sit at depth two; v1 allows one level below platform, so set it to "platform"`,
  ]);
});

test("depth two keeps the other claim errors and drops only the non-root message", () => {
  const quota = `${file}.spec.quota: is required for a suborg, and has no default: set requests.cpu, requests.memory, pods and storage`;
  vi.mocked(platformClaimErrors).mockReturnValue([
    nonRootParent,
    "claims[0].spec.quota: is required for a suborg, and has no default: set requests.cpu, requests.memory, pods and storage",
  ]);
  expect(
    check({ ...suborg, spec: { ...suborg.spec, parent: "api" } }, "api", [
      "api",
    ]),
  ).toEqual([
    quota,
    `${file}.spec.parent: "api" is a suborg, so this suborg would sit at depth two; v1 allows one level below platform, so set it to "platform"`,
  ]);
});

test("a parent that is not a suborg of this environment keeps the claim rule's non-root message under the file path", () => {
  vi.mocked(platformClaimErrors).mockReturnValue([nonRootParent]);
  expect(
    check({ ...suborg, spec: { ...suborg.spec, parent: "payments" } }),
  ).toEqual([nonRootParentAtFile]);
});

test("a valid suborg is reported with its default zone under the platform domain", async () => {
  directory({ "api.json": JSON.stringify(suborg) });
  expect(await report()).toEqual({
    errors: [],
    organizations: [{ name: "api", zone: "api.kore.internal" }],
  });
  expect(suborgDefaultZone).toHaveBeenCalledWith("api", "kore.internal");
});

test("a record that fails the claim rules is reported in errors and left out of organizations", async () => {
  vi.mocked(platformClaimErrors).mockReturnValue([
    "claims[0].spec.quota: is required for a suborg, and has no default: set requests.cpu, requests.memory, pods and storage",
  ]);
  directory({ "api.json": JSON.stringify(suborg) });
  expect(await report()).toEqual({
    errors: [
      `${file}.spec.quota: is required for a suborg, and has no default: set requests.cpu, requests.memory, pods and storage`,
    ],
    organizations: [],
  });
  expect(suborgDefaultZone).not.toHaveBeenCalled();
});

test("an environment with no organizations directory has nothing to check", async () => {
  vi.mocked(readdir).mockRejectedValue(
    Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
  );
  expect(await report()).toEqual({ errors: [], organizations: [] });
  expect(readFile).not.toHaveBeenCalled();
});

test("the suborg names are the valid records' names in name order, so a record that fails the rules is no suborg and a suborg with no record has no name", async () => {
  directory({
    "team-b.json": JSON.stringify({ ...suborg, metadata: { name: "team-b" } }),
    "broken.json": JSON.stringify({ ...suborg, metadata: { name: "broken" } }),
    "api.json": JSON.stringify(suborg),
  });
  vi.mocked(platformClaimErrors).mockImplementation((claims) =>
    JSON.stringify(claims).includes('"name":"broken"')
      ? ["claims[0].spec.quota: is required for a suborg, and has no default"]
      : [],
  );
  expect(
    await suborgNames({
      root,
      environment,
      catalogNamespaces: ["argocd", "keycloak"],
    }),
  ).toEqual(["api", "team-b"]);
});

test("each suborg record's internal zone is checked in its environment, and its refusals join the record's", async () => {
  const refusal = `${file}.spec.internalZone: is required while platform-hostname-ownership is on`;
  vi.mocked(suborgInternalZoneErrors).mockReturnValue([refusal]);
  directory({ "api.json": JSON.stringify(suborg) });
  expect(await report()).toEqual({
    errors: [refusal],
    organizations: [{ name: "api", zone: "api.kore.internal" }],
  });
  expect(suborgInternalZoneErrors).toHaveBeenCalledWith({
    environment,
    file,
    organization: "api",
    manifest: suborg,
  });
});

test("an environment with no organizations directory has no suborg names", async () => {
  vi.mocked(readdir).mockRejectedValue(
    Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
  );
  expect(
    await suborgNames({
      root,
      environment,
      catalogNamespaces: ["argocd", "keycloak"],
    }),
  ).toEqual([]);
});

test("a file in the organizations directory that is not <suborg>.json is refused and not read", async () => {
  directory({ "notes.txt": "not a record" });
  expect(await report()).toEqual({
    errors: [
      "infra/environments/local/organizations/notes.txt: the organizations directory holds <suborg>.json files only",
    ],
    organizations: [],
  });
  expect(readFile).not.toHaveBeenCalled();
});
