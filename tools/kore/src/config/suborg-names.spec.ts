// Docs: docs/decisions/0165-a-suborg-is-the-namespace-quota-and-trust-boundary-of-its-services.md
import { expect, test } from "vitest";
import {
  reservedNameErrors,
  reservedSuborgNames,
  suborgDefaultZone,
} from "./suborg-names.js";

test("every namespace the catalog installs is a reserved suborg name", () => {
  const reserved = reservedSuborgNames(["argocd", "kore-system", "keycloak"]);
  expect(reserved.has("argocd")).toBe(true);
  expect(reserved.has("keycloak")).toBe(true);
  expect(reserved.has("kore-system")).toBe(true);
});

test("a platform namespace added to the catalog is reserved with no code change", () => {
  const reserved = reservedSuborgNames(["argocd", "new-platform-namespace"]);
  expect(reserved.has("new-platform-namespace")).toBe(true);
});

test("default, internal, www and reference are reserved beside the catalog namespaces", () => {
  const reserved = reservedSuborgNames([]);
  for (const name of ["default", "internal", "www", "reference"]) {
    expect(reserved.has(name), name).toBe(true);
  }
});

test("a reserved suborg name names the field, the reason and a new name", () => {
  const reserved = reservedSuborgNames(["argocd"]);
  expect(reservedNameErrors("argocd", "api.json", reserved)).toEqual([
    'api.json.metadata.name: "argocd" is a reserved name: it is a platform namespace, default, internal, www or reference; choose another name, for example "argocd-team"',
  ]);
});

test("a suborg name with the kube- or kore- prefix is refused, naming the prefix and a fix", () => {
  const reserved = reservedSuborgNames([]);
  expect(reservedNameErrors("kube-apps", "api.json", reserved)).toEqual([
    'api.json.metadata.name: must not start with kube- or kore-, the reserved prefixes; rename it, for example "apps"',
  ]);
  expect(reservedNameErrors("kore-apps", "api.json", reserved)).toEqual([
    'api.json.metadata.name: must not start with kube- or kore-, the reserved prefixes; rename it, for example "apps"',
  ]);
});

test("an unreserved suborg name passes", () => {
  expect(
    reservedNameErrors("payments", "api.json", reservedSuborgNames(["argocd"])),
  ).toEqual([]);
});

test("the default zone of a suborg is <suborg>.<platform domain>", () => {
  expect(suborgDefaultZone("api", "kore.internal")).toBe("api.kore.internal");
});
