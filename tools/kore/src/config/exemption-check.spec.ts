// Docs: docs/decisions/0066-opa-receives-peer-identity-via-xfcc.md (exemption by name)
import { expect, test } from "vitest";
import { ExemptionCheck } from "./exemption-check.js";
import type { ExemptionSource, ListedExemption } from "./exemption-check.js";
import { fakeComponent } from "./config-support.js";

const components = [
  fakeComponent({ name: "cert-manager", namespace: "cert-manager" }),
];

function listed(fields: Partial<ListedExemption> = {}): ListedExemption {
  return {
    kind: "KoreContainerSecurity",
    name: "kore-container-security",
    namespace: "cert-manager",
    component: "cert-manager",
    adr: 66,
    reason: "upstream chart",
    ...fields,
  };
}

function check(source: Partial<ExemptionSource> = {}): ExemptionCheck {
  return new ExemptionCheck({
    constraints: async () => [
      {
        kind: "KoreContainerSecurity",
        name: "kore-container-security",
        exemptNamespaces: ["cert-manager"],
      },
    ],
    listed: async () => [listed()],
    adrStatus: async () => "accepted",
    applicationNamespaces: async () => [],
    ...source,
  });
}

test("a listed, ADR-backed exemption of a component namespace raises nothing", async () => {
  expect(await check().findings(components)).toEqual([]);
});

test("the cluster-provided marker is accepted without a catalog component", async () => {
  const findings = await check({
    constraints: async () => [
      {
        kind: "KoreContainerSecurity",
        name: "kore-container-security",
        exemptNamespaces: ["kube-system"],
      },
    ],
    listed: async () => [
      listed({ namespace: "kube-system", component: "cluster-provided" }),
    ],
  }).findings(components);
  expect(findings).toEqual([]);
});

test("an exempt namespace missing from the catalog file names the constraint, the namespace and the fix", async () => {
  const findings = await check({ listed: async () => [] }).findings(components);
  expect(findings).toEqual([
    "exemption: kore-container-security exempts namespace cert-manager, which gatekeeper-exemptions.yaml does not list; add an entry with its component and accepted ADR, or remove the namespace from exemptNamespaces",
  ]);
});

test("an entry whose component is not in the catalog is reported", async () => {
  const findings = await check({
    listed: async () => [listed({ component: "ghost" })],
  }).findings(components);
  expect(findings).toEqual([
    "exemption: kore-container-security namespace cert-manager names component ghost, which is not in the catalog; name the owning component or use cluster-provided",
  ]);
});

test("an entry whose component runs in a different namespace is reported", async () => {
  const findings = await check({
    listed: async () => [listed({ component: "other" })],
  }).findings([
    fakeComponent({ name: "other", namespace: "elsewhere" }),
    ...components,
  ]);
  expect(findings).toEqual([
    "exemption: kore-container-security namespace cert-manager is not the namespace of component other (elsewhere); name the component that owns cert-manager or use cluster-provided",
  ]);
});

test.each([
  ["missing", undefined],
  ["proposed", "proposed"],
  ["superseded", "superseded"],
])("an entry whose ADR is %s is reported", async (state, status) => {
  const findings = await check({ adrStatus: async () => status }).findings(
    components,
  );
  expect(findings).toEqual([
    `exemption: kore-container-security namespace cert-manager cites ADR 0066, which is ${state}; cite an accepted ADR or remove the exemption`,
  ]);
});

test("an exempt application namespace is reported", async () => {
  const findings = await check({
    applicationNamespaces: async () => ["cert-manager"],
  }).findings(components);
  expect(findings).toEqual([
    "exemption: kore-container-security exempts application namespace cert-manager; remove it from exemptNamespaces, since applications are never exempt",
  ]);
});

test("a listed entry no constraint uses is reported as unused", async () => {
  const findings = await check({
    listed: async () => [listed(), listed({ namespace: "gone" })],
  }).findings(components);
  expect(findings).toEqual([
    "exemption: kore-container-security namespace gone is listed but no constraint exempts it; remove the entry from gatekeeper-exemptions.yaml",
  ]);
});

test("each finding is reported once even when two rules would repeat it", async () => {
  const findings = await check({
    adrStatus: async () => undefined,
    listed: async () => [listed(), listed()],
  }).findings(components);
  expect(findings).toHaveLength(1);
});
