import assert from "node:assert/strict";
import { test } from "vitest";

import {
  documents,
  mapping,
  render,
  suborgOn,
} from "./suborg-render-support.js";

// Issue 1553 (ADR 0165): the Organization composition creates each suborg's AppProject in
// the Argo CD namespace, so Crossplane's service account needs write access to AppProjects
// there. Crossplane watches the kinds it composes cluster-wide, so it also needs get, list
// and watch on AppProjects in every namespace. With suborg-tenancy and
// suborg-delivery-project on, the chart grants the reads through a ClusterRole and a
// ClusterRoleBinding and the writes through a Role and a RoleBinding in argocd; with either
// flag off, it grants neither.

const deliveryOn: string[] = [
  ...suborgOn(false),
  "--set",
  "features.suborg-delivery-project=true",
  "--set-string",
  "suborgDelivery.repoURL=https://github.com/corekraft/kore.git",
];

const grantName = "crossplane-suborg-appprojects";

/** The documents of a kind in a render. */
function allOfKind(rendered: string, kind: string): string[] {
  return documents(rendered).filter((document) =>
    new RegExp(`^kind: ${kind}$`, "m").test(document),
  );
}

/** The documents of a kind in a render that carry the AppProject grant's name. */
function grantsOfKind(rendered: string, kind: string): string[] {
  return allOfKind(rendered, kind).filter((document) =>
    new RegExp(`^  name: ${grantName}$`, "m").test(document),
  );
}

/** Asserts a render holds none of the four AppProject grant documents. */
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

test("with both flags on, a Role in argocd lets Crossplane write AppProjects and nothing else", () => {
  const roles = allOfKind(render(...deliveryOn), "Role");
  assert.equal(roles.length, 1, "one Role");
  const [role] = roles;
  assert.match(role!, /^  name: crossplane-suborg-appprojects$/m);
  assert.match(
    role!,
    /^  namespace: argocd$/m,
    "scoped to the Argo CD namespace",
  );
  assert.match(
    role!,
    /^rules:\n  - apiGroups: \[argoproj\.io\]\n    resources: \[appprojects\]\n    verbs: \[create, update, patch, delete\]$/m,
    "AppProjects of argoproj.io, with the four write verbs the composition needs",
  );
  assert.equal(
    [...role!.matchAll(/^  - apiGroups:/gm)].length,
    1,
    "one rule, so no other resource is granted",
  );
});

test("with both flags on, a RoleBinding in argocd binds that Role to the crossplane service account", () => {
  const bindings = allOfKind(render(...deliveryOn), "RoleBinding");
  assert.equal(bindings.length, 1, "one RoleBinding");
  const [binding] = bindings;
  assert.match(binding!, /^  name: crossplane-suborg-appprojects$/m);
  assert.match(binding!, /^  namespace: argocd$/m);
  assert.deepEqual(mapping(binding!, "roleRef"), {
    apiGroup: "rbac.authorization.k8s.io",
    kind: "Role",
    name: "crossplane-suborg-appprojects",
  });
  assert.match(
    binding!,
    /^subjects:\n  - kind: ServiceAccount\n    name: crossplane\n    namespace: crossplane-system$/m,
  );
});

test("with both flags on, a ClusterRole lets Crossplane read AppProjects cluster-wide and nothing else", () => {
  const roles = grantsOfKind(render(...deliveryOn), "ClusterRole");
  assert.equal(roles.length, 1, "one ClusterRole for AppProjects");
  const [role] = roles;
  assert.doesNotMatch(role!, /^  namespace:/m, "cluster-scoped");
  assert.match(
    role!,
    /^rules:\n  - apiGroups: \[argoproj\.io\]\n    resources: \[appprojects\]\n    verbs: \[get, list, watch\]$/m,
    "AppProjects of argoproj.io, with only the read verbs Crossplane's watch needs",
  );
  assert.equal(
    [...role!.matchAll(/^  - apiGroups:/gm)].length,
    1,
    "one rule, so no other resource is granted",
  );
});

test("with both flags on, a ClusterRoleBinding binds that ClusterRole to the crossplane service account", () => {
  const bindings = grantsOfKind(render(...deliveryOn), "ClusterRoleBinding");
  assert.equal(bindings.length, 1, "one ClusterRoleBinding for AppProjects");
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

test("with suborg-delivery-project off, the chart grants Crossplane nothing on AppProjects", () => {
  for (const rendered of [
    render(...suborgOn(false)),
    render(
      ...suborgOn(false),
      "--set",
      "features.suborg-delivery-project=false",
    ),
  ]) {
    assertNoGrant(rendered);
  }
});

test("with suborg-delivery-project on but suborg-tenancy off, the chart grants Crossplane nothing on AppProjects", () => {
  const rendered = render(
    "--set",
    "features.suborg-tenancy=false",
    "--set",
    "features.suborg-delivery-project=true",
    "--set-string",
    "suborgDelivery.repoURL=https://github.com/corekraft/kore.git",
  );
  assertNoGrant(rendered);
});
