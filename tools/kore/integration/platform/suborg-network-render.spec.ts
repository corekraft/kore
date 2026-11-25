import assert from "node:assert/strict";
import { test } from "vitest";

import {
  composition,
  documents,
  render,
  renderStep,
  stepTemplate,
  suborg,
  networkOn,
  suborgOn,
} from "./suborg-render-support.js";

/** The object of a kind with the given name in a render, or undefined. */
function named(
  rendered: string,
  kind: string,
  name: string,
): string | undefined {
  return documents(rendered).find(
    (document) =>
      new RegExp(`^kind: ${kind}$`, "m").test(document) &&
      new RegExp(`^  name: ${name}$`, "m").test(document),
  );
}

/** The namespaces a policy's selectors name, in document order. */
function namespacesNamed(document: string): string[] {
  return [...document.matchAll(/kubernetes\.io\/metadata\.name: (\S+)$/gm)].map(
    (match) => match[1]!,
  );
}

/** The port numbers a policy names, in document order. */
function portsNamed(document: string): string[] {
  return [...document.matchAll(/port: (\d+)$/gm)].map((match) => match[1]!);
}

/** The Organization composition's network-policy step, rendered for a suborg. */
async function suborgNetworkPolicies(
  resource: Record<string, unknown> = suborg,
  extra: string[] = [],
): Promise<string> {
  const step = stepTemplate(
    composition(
      render(...suborgOn(false), ...networkOn, ...extra),
      "organization-local",
    ),
    "compose-suborg-network-policies",
  );
  return renderStep(step, resource);
}

test("with suborg-tenancy absent the Organization composition has no network policy step", () => {
  const organization = composition(render(), "organization-local");
  assert.doesNotMatch(organization, /compose-suborg-network-policies/);
});

test("each suborg namespace gets a default-deny ingress policy that selects every pod in it", async () => {
  const rendered = await suborgNetworkPolicies();
  const deny = named(rendered, "NetworkPolicy", "suborg-default-deny-ingress")!;
  assert.ok(deny, "the suborg has a default-deny ingress NetworkPolicy");
  assert.match(deny, /^  namespace: api$/m);
  assert.match(deny, /^spec:\n  podSelector: \{\}$/m);
  assert.match(deny, /^  policyTypes: \[Ingress\]$/m);
  assert.doesNotMatch(deny, /Egress/);
});

test("the ingress default-deny admits the same suborg, the shared gateway, platform telemetry, kubelet probes and DNS, and nothing else", async () => {
  const deny = named(
    await suborgNetworkPolicies(),
    "NetworkPolicy",
    "suborg-default-deny-ingress",
  )!;
  assert.deepEqual(namespacesNamed(deny), [
    "kore-system",
    "observability",
    "kube-system",
    "kore-dns",
  ]);
  assert.match(
    deny,
    /gateway\.networking\.k8s\.io\/gateway-name: kore-gateway$/m,
  );
  assert.match(deny, /^\s+- podSelector: \{\}$/m, "pods of the same suborg");
  assert.match(deny, /cidr: 169\.254\.7\.127\/32$/m, "kubelet probes");
  assert.deepEqual(portsNamed(deny), ["53", "53"], "DNS on port 53 only");
  assert.doesNotMatch(deny, /0\.0\.0\.0\/0/, "no open source address");
});

test("the egress policy opens only DNS by name, so other suborgs and the platform namespaces are denied", async () => {
  const egress = named(
    await suborgNetworkPolicies(),
    "NetworkPolicy",
    "suborg-egress",
  )!;
  assert.ok(egress, "the suborg has an egress NetworkPolicy");
  assert.match(egress, /^  policyTypes: \[Egress\]$/m);
  assert.doesNotMatch(egress, /Ingress/);
  assert.deepEqual(
    namespacesNamed(egress),
    ["kube-system", "kore-dns"],
    "only the DNS namespaces are named; other suborgs and platform namespaces are not",
  );
  assert.deepEqual(portsNamed(egress), ["53", "53"], "DNS on port 53 only");
});

test("the egress policy's open internet rule excludes the pod range and the service range", async () => {
  const egress = named(
    await suborgNetworkPolicies(),
    "NetworkPolicy",
    "suborg-egress",
  )!;
  assert.match(egress, /cidr: 0\.0\.0\.0\/0$/m);
  assert.match(
    egress,
    /except:\n\s+- 10\.42\.0\.0\/16\n\s+- 10\.96\.0\.0\/12$/m,
    "the k3s pod range and the environment's service range are excluded",
  );
});

test("the egress policy excludes a pod range and an API address the environment records", async () => {
  const egress = named(
    await suborgNetworkPolicies(suborg, [
      "--set-string",
      "suborgNetwork.podCidr=10.244.0.0/16",
      "--set-json",
      'suborgNetwork.apiServerCidrs=["203.0.113.10/32"]',
    ]),
    "NetworkPolicy",
    "suborg-egress",
  )!;
  assert.match(egress, /- 10\.244\.0\.0\/16$/m);
  assert.match(
    egress,
    /- 203\.0\.113\.10\/32$/m,
    "the API address is excluded",
  );
  assert.doesNotMatch(egress, /10\.42\.0\.0\/16/);
});

test("a suborg with no parent, the platform tenant root, gets no network policies", async () => {
  const rendered = await suborgNetworkPolicies({
    metadata: { name: "platform" },
    spec: { tenant: "platform" },
  });
  assert.equal(
    documents(rendered).filter((document) =>
      /^kind: NetworkPolicy$/m.test(document),
    ).length,
    0,
  );
});

test("with both flags on and no service range recorded the Organization composition refuses to render, naming both flags and the field to set", () => {
  assert.throws(
    () =>
      render(
        ...suborgOn(false),
        "--set",
        "features.suborg-network-policy=true",
      ),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /suborg-tenancy and suborg-network-policy are on/);
      assert.match(message, /cluster\.serviceCidr/);
      return true;
    },
  );
});

test("with suborg-tenancy on and suborg-network-policy off neither network step is composed and no policy kind renders", () => {
  const rendered = render(...suborgOn(false));
  assert.doesNotMatch(
    composition(rendered, "organization-local"),
    /compose-suborg-network-policies/,
  );
  assert.doesNotMatch(
    composition(rendered, "service-local"),
    /compose-grant-policies/,
  );
  assert.doesNotMatch(rendered, /kind: (NetworkPolicy|AuthorizationPolicy)$/m);
});

test("suborg-network-policy alone, without suborg-tenancy, renders no network policy and no grant step", () => {
  const rendered = render(
    "--set",
    "features.suborg-network-policy=true",
    "--set-string",
    "suborgNetwork.serviceCidr=10.96.0.0/12",
  );
  assert.doesNotMatch(
    composition(rendered, "organization-local"),
    /compose-suborg-network-policies/,
  );
  assert.doesNotMatch(
    composition(rendered, "service-local"),
    /compose-grant-policies/,
  );
  assert.doesNotMatch(rendered, /kind: (NetworkPolicy|AuthorizationPolicy)$/m);
});

test("with suborg-tenancy off the platform-apis render has no NetworkPolicy and no AuthorizationPolicy anywhere", () => {
  assert.doesNotMatch(render(), /kind: (NetworkPolicy|AuthorizationPolicy)$/m);
});

test("with suborg-tenancy absent the Service composition has no grant step", () => {
  const service = composition(render(), "service-local");
  assert.doesNotMatch(service, /compose-grant-policies/);
});

/** The Service composition's grant step, rendered for a service and its grants. */
async function grantPolicies(
  name: string,
  organization: string,
  allowFrom: string[],
): Promise<string> {
  const step = stepTemplate(
    composition(render(...suborgOn(false), ...networkOn), "service-local"),
    "compose-grant-policies",
  );
  return renderStep(step, {
    metadata: { name },
    spec: { organization, allowFrom },
  });
}

test("with suborg-tenancy on the Service composition has one step that composes the grant policies before it is ready", () => {
  const service = composition(
    render(...suborgOn(false), ...networkOn),
    "service-local",
  );
  assert.match(service, /- step: compose-grant-policies/);
  assert.ok(
    service.indexOf("- step: compose-grant-policies") <
      service.indexOf("- step: mark-ready"),
  );
});

test("a service with no grants renders no grant policy", async () => {
  assert.equal(documents(await grantPolicies("leads", "api", [])).length, 0);
});

test("a grant to a service in another suborg becomes an identity-based AuthorizationPolicy naming the grantee's ServiceAccount", async () => {
  const rendered = await grantPolicies("leads", "api", ["ops/reports"]);
  const policy = named(rendered, "AuthorizationPolicy", "leads--grants")!;
  assert.ok(policy, "the service has an AuthorizationPolicy for its grants");
  assert.match(policy, /^  namespace: api$/m, "it lives in the owner's suborg");
  assert.match(policy, /^  action: ALLOW$/m);
  assert.match(
    policy,
    /app\.kubernetes\.io\/part-of: leads$/m,
    "it selects the owner's pods",
  );
  assert.match(
    policy,
    /principals: \["cluster\.local\/ns\/ops\/sa\/reports"\]/,
    "the grantee's identity is the ServiceAccount named after the grantee service in its suborg",
  );
});

test("a grant's NetworkPolicy opens the owner's pods to the grantee's namespace only", async () => {
  const rendered = await grantPolicies("leads", "api", ["ops/reports"]);
  const policy = named(
    rendered,
    "NetworkPolicy",
    "leads--grant--ops--reports",
  )!;
  assert.ok(policy, "the grant has a NetworkPolicy");
  assert.match(policy, /^  namespace: api$/m);
  assert.match(policy, /app\.kubernetes\.io\/part-of: leads$/m);
  assert.match(policy, /^  policyTypes: \[Ingress\]$/m);
  assert.deepEqual(namespacesNamed(policy), ["ops"]);
  assert.doesNotMatch(policy, /cidr:/, "no address opens with the grant");
});

test("a grant to a service in the same suborg adds nothing", async () => {
  assert.equal(
    documents(await grantPolicies("leads", "api", ["api/reports"])).length,
    0,
  );
});

test("a removed grant leaves no rule, while the grants still in allowFrom keep theirs", async () => {
  const both = await grantPolicies("leads", "api", [
    "ops/reports",
    "ops/billing",
  ]);
  assert.ok(both.includes("cluster.local/ns/ops/sa/billing"));
  const one = await grantPolicies("leads", "api", ["ops/reports"]);
  assert.doesNotMatch(
    one,
    /billing/,
    "the removed grant leaves no principal and no NetworkPolicy",
  );
  assert.ok(one.includes("cluster.local/ns/ops/sa/reports"));
  const none = await grantPolicies("leads", "api", []);
  assert.equal(documents(none).length, 0, "with no grant left nothing renders");
});

test("the grant AuthorizationPolicy also admits the owner's suborg, platform telemetry and the shared gateway, so a grant cuts none of them off", async () => {
  const policy = named(
    await grantPolicies("leads", "api", ["ops/reports"]),
    "AuthorizationPolicy",
    "leads--grants",
  )!;
  const sources = /namespaces: \[([^\]]*)\]/.exec(policy)?.[1] ?? "";
  assert.deepEqual(
    sources.match(/[a-z0-9-]+/g),
    ["api", "observability"],
    "the owner's suborg and platform telemetry are admitted by namespace",
  );
  assert.match(
    policy,
    /principals: \["cluster\.local\/ns\/kore-system\/sa\/kore-gateway"\]/,
  );
});
