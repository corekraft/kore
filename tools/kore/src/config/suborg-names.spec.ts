// Docs: docs/decisions/0165-a-suborg-is-the-namespace-quota-and-trust-boundary-of-its-services.md
import { expect, test, vi } from "vitest";
import { featureEnabled } from "./features.js";
import {
  maxSecretStoreSuborgName,
  reservedNameErrors,
  reservedSuborgNames,
  secretStoreNameErrors,
  suborgDefaultZone,
  suborgSecretStoreOn,
  suborgSourceNamespace,
} from "./suborg-names.js";

vi.mock("./features.js");

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

test("the Argo CD project the platform owns for its configuration is a reserved suborg name, so a suborg's project cannot take it", () => {
  const reserved = reservedSuborgNames([]);
  expect(reserved.has("platform-configuration")).toBe(true);
  expect(
    reservedNameErrors("platform-configuration", "api.json", reserved),
  ).toEqual([
    'api.json.metadata.name: "platform-configuration" is a reserved name: it is a platform namespace, an Argo CD project the platform owns, default, internal, www or reference; choose another name, for example "platform-configuration-team"',
  ]);
});

test("a reserved suborg name names the field, the reason and a new name", () => {
  const reserved = reservedSuborgNames(["argocd"]);
  expect(reservedNameErrors("argocd", "api.json", reserved)).toEqual([
    'api.json.metadata.name: "argocd" is a reserved name: it is a platform namespace, an Argo CD project the platform owns, default, internal, www or reference; choose another name, for example "argocd-team"',
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

test("suborg-secret-store is on for an environment only when that environment turns the flag on", () => {
  vi.mocked(featureEnabled).mockImplementation(
    (environment, flag) => environment.features?.[flag] === true,
  );
  expect(
    suborgSecretStoreOn({ features: { "suborg-secret-store": true } }),
  ).toBe(true);
  expect(
    suborgSecretStoreOn({ features: { "suborg-secret-store": false } }),
  ).toBe(false);
  expect(suborgSecretStoreOn({})).toBe(false);
  expect(featureEnabled).toHaveBeenCalledWith(
    { features: { "suborg-secret-store": true } },
    "suborg-secret-store",
  );
});

test("a suborg's source namespace is kore-suborg- and the suborg's name, and no suborg may take that name, since kore- is reserved", () => {
  expect(suborgSourceNamespace("api")).toBe("kore-suborg-api");
  expect(
    reservedNameErrors(
      suborgSourceNamespace("api"),
      "api.json",
      reservedSuborgNames([]),
    ),
  ).toEqual([
    'api.json.metadata.name: must not start with kube- or kore-, the reserved prefixes; rename it, for example "suborg-api"',
  ]);
});

test("a suborg name of 51 characters has a source namespace within the 63-character namespace limit, so it passes", () => {
  const name = "a".repeat(maxSecretStoreSuborgName);
  expect(maxSecretStoreSuborgName).toBe(51);
  expect(suborgSourceNamespace(name).length).toBe(63);
  expect(secretStoreNameErrors(name, "api.json")).toEqual([]);
});

test("a suborg name of 52 characters is refused, naming the flag, the limit and a shorter name", () => {
  const name = "a".repeat(52);
  expect(secretStoreNameErrors(name, "api.json")).toEqual([
    `api.json.metadata.name: "${name}" is 52 characters, too long for its source namespace kore-suborg-${name} while suborg-secret-store is on: a namespace name is at most 63 characters, so a suborg name is at most 51 with that flag; choose a shorter name, for example "${"a".repeat(51)}", or turn suborg-secret-store off`,
  ]);
});
