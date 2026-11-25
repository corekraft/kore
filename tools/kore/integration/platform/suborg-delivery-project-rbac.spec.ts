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
// there. With suborg-tenancy and suborg-delivery-project on, the chart grants it through a
// Role and a RoleBinding in argocd; with either flag off, it grants nothing.

const deliveryOn: string[] = [
  ...suborgOn(false),
  "--set",
  "features.suborg-delivery-project=true",
  "--set-string",
  "suborgDelivery.repoURL=https://github.com/corekraft/kore.git",
];

/** The documents of a kind in a render. */
function allOfKind(rendered: string, kind: string): string[] {
  return documents(rendered).filter((document) =>
    new RegExp(`^kind: ${kind}$`, "m").test(document),
  );
}

test("with both flags on, a Role in argocd lets Crossplane manage AppProjects and nothing else", () => {
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
    /^rules:\n  - apiGroups: \[argoproj\.io\]\n    resources: \[appprojects\]\n    verbs: \[get, list, watch, create, update, patch, delete\]$/m,
    "AppProjects of argoproj.io, with the seven verbs the composition needs",
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

test("with suborg-delivery-project off, the chart grants Crossplane nothing in argocd", () => {
  for (const rendered of [
    render(...suborgOn(false)),
    render(
      ...suborgOn(false),
      "--set",
      "features.suborg-delivery-project=false",
    ),
  ]) {
    assert.deepEqual(allOfKind(rendered, "Role"), []);
    assert.deepEqual(allOfKind(rendered, "RoleBinding"), []);
  }
});

test("with suborg-delivery-project on but suborg-tenancy off, the chart grants Crossplane nothing in argocd", () => {
  const rendered = render(
    "--set",
    "features.suborg-tenancy=false",
    "--set",
    "features.suborg-delivery-project=true",
    "--set-string",
    "suborgDelivery.repoURL=https://github.com/corekraft/kore.git",
  );
  assert.deepEqual(allOfKind(rendered, "Role"), []);
  assert.deepEqual(allOfKind(rendered, "RoleBinding"), []);
});
