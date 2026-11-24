// The app record check of kore validate over fixture repositories: each spec file
// and release file against the chart's Service schema and the ServiceRelease schema,
// the cross-file rules, and name uniqueness across the cluster. The base-ref and yq
// cases are in app-record-base.spec.ts.
import { afterEach, expect, test } from "vitest";
import {
  digest,
  dir,
  fixture,
  record,
  release,
  type Fixture,
} from "./app-records-support.js";

const made: Fixture[] = [];

async function repo(...args: Parameters<typeof fixture>): Promise<Fixture> {
  const created = await fixture(...args);
  made.push(created);
  return created;
}

afterEach(async () => {
  for (const created of made.splice(0)) {
    await created.remove();
  }
});

test("a valid spec file and release file pass, with no errors and no warnings", async () => {
  const f = await repo({
    [`${dir}/leads.json`]: record("leads"),
    [`${dir}/leads.release.json`]: release("leads"),
  });
  expect(await f.check()).toEqual({ errors: [], warnings: [] });
});

test("an unknown field in a spec file fails, naming the file, the field and the fields that are allowed", async () => {
  const f = await repo({
    [`${dir}/leads.json`]: record("leads", { replicas: 3 }),
    [`${dir}/leads.release.json`]: release("leads"),
  });
  expect((await f.check()).errors).toEqual([
    `${dir}/leads.json: spec.replicas is not a field of this record; the fields here are organization, environments, repository, path, components, gateway, hostnames, backup, allowFrom, secrets`,
  ]);
});

test("a digest in a spec file fails, saying only the release file carries it", async () => {
  const f = await repo({
    [`${dir}/leads.json`]: record("leads", {
      components: { frontend: { digest } },
    }),
  });
  expect((await f.check()).errors).toEqual([
    `${dir}/leads.json: spec.components.frontend.digest belongs to the release file, not the spec file: only leads.release.json carries image digests, the source commit, attestations and flag state (ADR 0166, ADR 0169)`,
  ]);
});

test("flag state in a release file fails as an unknown field, saying flag state is not in the release file", async () => {
  const f = await repo({
    [`${dir}/leads.json`]: record("leads"),
    [`${dir}/leads.release.json`]: release("leads", {
      flags: { "leads.new-checkout": false },
    }),
  });
  expect((await f.check()).errors).toEqual([
    `${dir}/leads.release.json: spec.flags: flag state is not in the release file; the platform holds it in the separate per-app state file (ADR 0169, #1571)`,
  ]);
});

test("a spec field in a release file fails, saying only the spec file carries it", async () => {
  const f = await repo({
    [`${dir}/leads.json`]: record("leads"),
    [`${dir}/leads.release.json`]: release("leads", { gateway: "external" }),
  });
  expect((await f.check()).errors).toEqual([
    `${dir}/leads.release.json: spec.gateway belongs to the spec file, not the release file: only leads.json carries the service's fields (ADR 0166)`,
  ]);
});

test("a malformed digest fails, naming the field and the pattern it must match", async () => {
  const f = await repo({
    [`${dir}/leads.json`]: record("leads"),
    [`${dir}/leads.release.json`]: release("leads", {
      components: { frontend: { digest: "sha256:abc" } },
    }),
  });
  expect((await f.check()).errors).toEqual([
    `${dir}/leads.release.json: spec.components.frontend.digest must match ^sha256:[0-9a-f]{64}$ (the image digest: sha256, a colon, then 64 lowercase hex characters)`,
  ]);
});

test("a source commit that is not 40 lowercase hex characters fails, naming the field", async () => {
  const f = await repo({
    [`${dir}/leads.json`]: record("leads"),
    [`${dir}/leads.release.json`]: release("leads", { commit: "ABC" }),
  });
  expect((await f.check()).errors).toEqual([
    `${dir}/leads.release.json: spec.commit must match ^[0-9a-f]{40}$ (the 40-character lowercase hex application source commit)`,
  ]);
});

test("a service with neither a frontend nor a bff component is refused", async () => {
  const f = await repo({
    [`${dir}/leads.json`]: record("leads", { components: {} }),
  });
  expect((await f.check()).errors).toEqual([
    `${dir}/leads.json: spec.components must have at least 1 field (frontend, bff or both: a service with neither is refused)`,
  ]);
});

test("a spec file that declares no components at all is refused as well", async () => {
  const text = JSON.parse(record("leads")) as { spec: Record<string, unknown> };
  delete text.spec.components;
  const f = await repo({ [`${dir}/leads.json`]: JSON.stringify(text) });
  expect((await f.check()).errors).toEqual([
    `${dir}/leads.json: spec.components is required: declare frontend, bff or both (a service with neither is refused)`,
  ]);
});

test("a release component the spec does not declare fails, naming the component and the spec file", async () => {
  const f = await repo({
    [`${dir}/leads.json`]: record("leads"),
    [`${dir}/leads.release.json`]: release("leads", {
      components: { bff: { digest } },
    }),
  });
  expect((await f.check()).errors).toEqual([
    `${dir}/leads.release.json: spec.components.bff is not declared in ${dir}/leads.json; declare the component in the spec file before a release carries its digest`,
  ]);
});

test("a release file with no spec file beside it fails", async () => {
  const f = await repo({ [`${dir}/leads.release.json`]: release("leads") });
  expect((await f.check()).errors).toEqual([
    `${dir}/leads.release.json: a release file needs its spec file leads.json beside it in ${dir}`,
  ]);
});

test("a spec whose name is not its file name fails, naming both", async () => {
  const f = await repo({ [`${dir}/leads.json`]: record("leads-api") });
  expect((await f.check()).errors).toEqual([
    `${dir}/leads.json: metadata.name leads-api must equal the file name leads, so the record is named after its file`,
  ]);
});

test("a record that is not strict JSON fails, naming the file", async () => {
  const f = await repo({ [`${dir}/leads.json`]: "{ organization: platform" });
  expect((await f.check()).errors).toEqual([
    expect.stringMatching(
      new RegExp(
        `^${dir.replaceAll(".", "\\.")}/leads\\.json: .*must be strict JSON`,
      ),
    ),
  ]);
});

test("a file in the services directory that is neither record kind fails", async () => {
  const f = await repo({ [`${dir}/notes.txt`]: "hello" });
  expect((await f.check()).errors).toEqual([
    `${dir}/notes.txt: the services directory holds <service>.json (the spec file) and <service>.release.json (the release file) only`,
  ]);
});

test("a name the legacy infra/services registrations already declare fails, listing both paths", async () => {
  const f = await repo({
    [`${dir}/leads.json`]: record("leads"),
    "infra/services/leads.yaml": JSON.stringify({
      apiVersion: "platform.kore.dev/v1alpha1",
      kind: "Service",
      metadata: { name: "leads" },
      spec: { organization: "platform", environments: ["local"] },
    }),
  });
  expect((await f.check()).errors).toEqual([
    `${dir}/leads.json and infra/services/leads.yaml both declare the service leads: a service name is unique across the cluster (ADR 0166); rename one of them`,
  ]);
});

test("the same name in another environment is allowed: one environment is one cluster", async () => {
  const f = await repo({
    [`${dir}/leads.json`]: record("leads"),
    "infra/environments/vps/services/leads.json": record("leads"),
  });
  expect(await f.check()).toEqual({ errors: [], warnings: [] });
});

const organizationPattern = "^[a-z0-9]([a-z0-9]|-[a-z0-9])*$";
const organizationNamePart =
  "a DNS label of lowercase letters and digits with single hyphens, at most 54 characters; platform is the tenant root";

test("a suborg name the chart's pattern accepts passes the Service schema, with no errors and no warnings", async () => {
  const f = await repo({
    [`${dir}/leads.json`]: record("leads", { organization: "sales" }),
    [`${dir}/leads.release.json`]: release("leads"),
  });
  expect(await f.check()).toEqual({ errors: [], warnings: [] });
});

test("an uppercase letter in the organization fails the chart's name pattern, naming the pattern and the rule", async () => {
  const f = await repo({
    [`${dir}/leads.json`]: record("leads", { organization: "Sales" }),
  });
  expect((await f.check()).errors).toEqual([
    `${dir}/leads.json: spec.organization must match ${organizationPattern} (${organizationNamePart})`,
  ]);
});

test("a double hyphen in the organization fails the chart's name pattern, because the namespace <suborg>--preview needs it", async () => {
  const f = await repo({
    [`${dir}/leads.json`]: record("leads", { organization: "sales--team" }),
  });
  expect((await f.check()).errors).toEqual([
    `${dir}/leads.json: spec.organization must match ${organizationPattern} (${organizationNamePart})`,
  ]);
});

test("an organization of 55 characters fails the chart's length cap of 54, and no other rule", async () => {
  const f = await repo({
    [`${dir}/leads.json`]: record("leads", { organization: "a".repeat(55) }),
  });
  expect((await f.check()).errors).toEqual([
    `${dir}/leads.json: spec.organization must be at most 54 characters`,
  ]);
});
