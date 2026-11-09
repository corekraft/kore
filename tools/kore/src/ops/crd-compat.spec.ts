import assert from "node:assert/strict";
import { test } from "vitest";
import {
  crdRollbackProblems,
  crdUpgradeProblems,
  type Crd,
} from "./crd-compat.js";

const schema = (extra: Record<string, unknown> = {}) => ({
  openAPIV3Schema: {
    type: "object",
    properties: {
      spec: { type: "object", properties: { a: { type: "string" }, ...extra } },
    },
  },
});

function crd(
  versions: {
    name: string;
    storage: boolean;
    served?: boolean;
    schema?: unknown;
  }[],
  conversion?: Crd["spec"]["conversion"],
): Crd {
  return {
    metadata: { name: "widgets.example.dev" },
    spec: {
      group: "example.dev",
      versions: versions.map((v) => ({
        name: v.name,
        served: v.served ?? true,
        storage: v.storage,
        schema: v.schema ?? schema(),
      })),
      ...(conversion ? { conversion } : {}),
    },
  };
}

const v1 = crd([{ name: "v1", storage: true }]);

test("an unchanged CRD set passes upgrade and rollback", () => {
  assert.deepEqual(crdUpgradeProblems([v1], [v1]), []);
  assert.deepEqual(crdRollbackProblems([v1], [v1]), []);
});

test("removing a CRD is reported because it deletes every custom resource", () => {
  assert.match(
    crdUpgradeProblems([v1], []).join(),
    /widgets\.example\.dev: CRD removed/,
  );
});

test("dropping the version objects are stored in is reported", () => {
  const next = crd([{ name: "v2", storage: true }]);
  assert.match(
    crdUpgradeProblems([v1], [next]).join("\n"),
    /widgets\.example\.dev: stored version v1 is no longer defined/,
  );
});

test("a storage version change with different schemas and no conversion webhook is reported", () => {
  const next = crd([
    { name: "v1", storage: false },
    {
      name: "v2",
      storage: true,
      schema: schema({ b: { type: "string" }, a: { type: "integer" } }),
    },
  ]);
  assert.match(
    crdUpgradeProblems([v1], [next]).join("\n"),
    /storage version moves from v1 to v2 with conversion None/,
  );
});

test("a storage version change with identical schemas is safe under None", () => {
  const next = crd([
    { name: "v1", storage: false },
    { name: "v2", storage: true },
  ]);
  assert.deepEqual(crdUpgradeProblems([v1], [next]), []);
});

test("a webhook conversion needs a client config and review versions", () => {
  const next = crd(
    [
      { name: "v1", storage: false },
      { name: "v2", storage: true, schema: schema({ b: { type: "string" } }) },
    ],
    {
      strategy: "Webhook",
      webhook: { clientConfig: {}, conversionReviewVersions: [] },
    },
  );
  const found = crdUpgradeProblems([v1], [next]).join("\n");
  assert.match(found, /webhook conversion has no clientConfig service or url/);
  assert.match(
    found,
    /webhook conversion declares no conversionReviewVersions/,
  );
});

test("a configured webhook conversion permits a storage version change", () => {
  const next = crd(
    [
      { name: "v1", storage: false },
      { name: "v2", storage: true, schema: schema({ b: { type: "string" } }) },
    ],
    {
      strategy: "Webhook",
      webhook: {
        clientConfig: { service: { name: "w", namespace: "n" } },
        conversionReviewVersions: ["v1"],
      },
    },
  );
  assert.deepEqual(crdUpgradeProblems([v1], [next]), []);
});

test("rollback is unsafe when the new CRD stores a version the old one does not define", () => {
  const next = crd([
    { name: "v1", storage: false },
    { name: "v2", storage: true },
  ]);
  assert.match(
    crdRollbackProblems([v1], [next]).join("\n"),
    /widgets\.example\.dev: rollback cannot read version v2/,
  );
});

test("rollback is safe when the storage version is unchanged", () => {
  const next = crd([
    { name: "v1", storage: true },
    { name: "v2", storage: false },
  ]);
  assert.deepEqual(crdRollbackProblems([v1], [next]), []);
});

test("a CRD new in the upgrade does not block rollback", () => {
  assert.deepEqual(crdRollbackProblems([], [v1]), []);
});
