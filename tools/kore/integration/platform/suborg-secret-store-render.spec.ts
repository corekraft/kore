import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";

import {
  composition,
  documents,
  mapping,
  render,
  renderStep,
  root,
  stepTemplate,
  suborg,
  suborgOn,
} from "./suborg-render-support.js";

// Issue 1555 (ADR 0167): with suborg-tenancy and suborg-secret-store on, the Organization
// composition makes one External Secrets ClusterSecretStore per suborg, named suborg-<name>,
// that admits only the suborg's own namespace and reads only its own source namespace,
// kore-suborg-<name>, which is composed beside it. The shared platform-secrets store is not
// touched. Crossplane needs cluster-wide access to ClusterSecretStores to compose them, which
// the chart grants through a ClusterRole and a ClusterRoleBinding. Off, the render is
// byte-identical to main.

const storeOn: string[] = [
  ...suborgOn(false),
  "--set",
  "features.suborg-secret-store=true",
];

const grantName = "crossplane-suborg-secret-stores";

/** The Organization composition's secret-store step, rendered for a suborg. */
async function suborgSecretStore(
  resource: Record<string, unknown> = suborg,
): Promise<string> {
  const step = stepTemplate(
    composition(render(...storeOn), "organization-local"),
    "compose-suborg-secret-store",
  );
  return renderStep(step, resource);
}

/** The documents of a kind in a rendered step or render. */
function ofKindAll(rendered: string, kind: string): string[] {
  return documents(rendered).filter((document) =>
    new RegExp(`^kind: ${kind}$`, "m").test(document),
  );
}

/** The documents of a kind in a render that carry the secret-store grant's name. */
function grantsOfKind(rendered: string, kind: string): string[] {
  return ofKindAll(rendered, kind).filter((document) =>
    new RegExp(`^  name: ${grantName}$`, "m").test(document),
  );
}

/** Asserts a render holds none of the four secret-store grant documents. */
function assertNoGrant(rendered: string): void {
  for (const kind of [
    "Role",
    "RoleBinding",
    "ClusterRole",
    "ClusterRoleBinding",
  ]) {
    assert.deepEqual(grantsOfKind(rendered, kind), [], `no ${kind}`);
  }
}

test("with suborg-secret-store absent the Organization composition has no secret-store step", () => {
  assert.doesNotMatch(
    composition(render(...suborgOn(false)), "organization-local"),
    /compose-suborg-secret-store/,
  );
});

test("with suborg-secret-store off the render is byte-identical to the suborg-tenancy golden, the flag adds nothing", async () => {
  const rendered = render(
    ...suborgOn(false),
    "--set",
    "features.suborg-secret-store=false",
  );
  assert.equal(
    rendered,
    await readFile(
      join(
        root,
        "tools/kore/src/platform/fixtures/platform-apis.suborg-tenancy-only.yaml",
      ),
      "utf8",
    ),
  );
});

test("with both flags on the Organization composition has one step that composes each suborg's store, before mark-ready", () => {
  const organization = composition(render(...storeOn), "organization-local");
  assert.match(organization, /- step: compose-suborg-secret-store/);
  assert.ok(
    organization.indexOf("- step: compose-suborg-secret-store") <
      organization.indexOf("- step: mark-ready"),
    "the store step runs before the Organization is marked ready",
  );
});

test("each suborg gets exactly one ClusterSecretStore, named suborg- and the suborg's name, and the external-secrets.io v1 kind", async () => {
  const stores = ofKindAll(await suborgSecretStore(), "ClusterSecretStore");
  assert.equal(stores.length, 1, "one store per suborg");
  const [store] = stores;
  assert.match(store!, /^apiVersion: external-secrets\.io\/v1$/m);
  assert.match(store!, /^metadata:\n  name: suborg-api$/m);
});

test("a suborg's store admits only its own namespace through its namespace condition", async () => {
  const [store] = ofKindAll(await suborgSecretStore(), "ClusterSecretStore");
  assert.match(
    store!,
    /^spec:\n  conditions:\n    - namespaces:\n        - api$/m,
    "one condition, naming exactly the suborg's namespace",
  );
  assert.equal(
    [...store!.matchAll(/^\s+- namespaces:/gm)].length,
    1,
    "one condition, so no other namespace is admitted",
  );
});

test("a suborg's store reads only its own source namespace, kore-suborg-<name>, and takes its CA from that namespace", async () => {
  const [store] = ofKindAll(await suborgSecretStore(), "ClusterSecretStore");
  assert.match(
    store!,
    /^ {6}remoteNamespace: kore-suborg-api$/m,
    "the kubernetes provider reads the suborg's own source namespace",
  );
  assert.match(
    store!,
    /caProvider: \{type: ConfigMap, name: kube-root-ca\.crt, key: ca\.crt, namespace: kore-suborg-api\}/,
    "the CA is read from the same namespace the store reads",
  );
});

test("a suborg's store authenticates as the External Secrets service account, against the cluster's API, as the platform store does", async () => {
  const [store] = ofKindAll(await suborgSecretStore(), "ClusterSecretStore");
  assert.match(store!, /^ {8}url: https:\/\/kubernetes\.default\.svc$/m);
  assert.match(
    store!,
    /^ {6}auth:\n {8}serviceAccount:\n {10}name: external-secrets\n {10}namespace: external-secrets$/m,
  );
});

test("a suborg's source namespace is composed beside its store, named kore-suborg-<name>, labelled as a secret source and in the ambient mesh", async () => {
  const [namespace] = ofKindAll(await suborgSecretStore(), "Namespace");
  assert.ok(namespace, "one source namespace per suborg");
  assert.match(namespace!, /^metadata:\n  name: kore-suborg-api$/m);
  assert.match(namespace!, /^    platform\.kore\.dev\/secret-source: "true"$/m);
  assert.match(
    namespace!,
    /^    istio\.io\/dataplane-mode: ambient$/m,
    "in the ambient mesh, as KoreMeshEnrollment requires of every namespace it does not exempt",
  );
  assert.equal(
    mapping(namespace!, "labels")["platform.kore.dev/secret-source"],
    "true",
    "the namespace is a secret source, as the platform's source namespace is",
  );
});

test("the shared platform-secrets store is untouched: the suborg store step names no platform store", () => {
  const step = stepTemplate(
    composition(render(...storeOn), "organization-local"),
    "compose-suborg-secret-store",
  );
  assert.doesNotMatch(step, /platform-secrets/);
  assert.doesNotMatch(step, /kore-secret-source/);
});

test("a suborg named platform-secrets gets the store suborg-platform-secrets, never the platform store's name", async () => {
  const stores = ofKindAll(
    await suborgSecretStore({
      metadata: { name: "platform-secrets" },
      spec: suborg.spec,
    }),
    "ClusterSecretStore",
  );
  assert.equal(stores.length, 1);
  assert.match(stores[0]!, /^metadata:\n  name: suborg-platform-secrets$/m);
  assert.doesNotMatch(stores[0]!, /^metadata:\n  name: platform-secrets$/m);
});

test("with both flags on, a ClusterRole lets Crossplane write ClusterSecretStores cluster-wide and nothing else", () => {
  const roles = grantsOfKind(render(...storeOn), "ClusterRole");
  assert.equal(roles.length, 1, "one ClusterRole for ClusterSecretStores");
  const [role] = roles;
  assert.doesNotMatch(role!, /^  namespace:/m, "cluster-scoped");
  assert.match(
    role!,
    /^rules:\n  - apiGroups: \[external-secrets\.io\]\n    resources: \[clustersecretstores\]\n    verbs: \[get, list, watch, create, update, patch, delete\]$/m,
    "ClusterSecretStores of external-secrets.io, with the verbs Crossplane composes and watches them with",
  );
  assert.equal(
    [...role!.matchAll(/^  - apiGroups:/gm)].length,
    1,
    "one rule, so no other resource is granted",
  );
});

test("with both flags on, a ClusterRoleBinding binds that ClusterRole to the crossplane service account", () => {
  const bindings = grantsOfKind(render(...storeOn), "ClusterRoleBinding");
  assert.equal(bindings.length, 1, "one ClusterRoleBinding");
  const [binding] = bindings;
  assert.doesNotMatch(binding!, /^  namespace:/m, "cluster-scoped");
  assert.deepEqual(mapping(binding!, "roleRef"), {
    apiGroup: "rbac.authorization.k8s.io",
    kind: "ClusterRole",
    name: grantName,
  });
  assert.match(
    binding!,
    /^subjects:\n  - kind: ServiceAccount\n    name: crossplane\n    namespace: crossplane-system$/m,
  );
});

test("with suborg-secret-store off, the chart grants Crossplane nothing on ClusterSecretStores", () => {
  assertNoGrant(render(...suborgOn(false)));
  assertNoGrant(
    render(...suborgOn(false), "--set", "features.suborg-secret-store=false"),
  );
});

test("with suborg-secret-store on but suborg-tenancy off, the chart renders no store and grants nothing", () => {
  const rendered = render(
    "--set",
    "features.suborg-tenancy=false",
    "--set",
    "features.suborg-secret-store=true",
  );
  assertNoGrant(rendered);
  assert.equal(ofKindAll(rendered, "ClusterSecretStore").length, 0);
});
