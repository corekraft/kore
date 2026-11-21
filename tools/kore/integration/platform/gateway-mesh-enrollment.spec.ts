import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "vitest";
import {
  agentgatewayMeshEnrollmentFlag,
  ingressFlag,
  loadRepository,
  type Repository,
} from "../../src/config/index.js";
import { helmTemplateArgs } from "../../src/platform/index.js";
import {
  withAbsoluteChart,
  withGatewayFlagsOff,
} from "../../src/testing/index.js";
import { localPlatform } from "../local-platform-support.js";

const platform = await localPlatform();

// The shared Gateway adds a standard-port entry to the Service and a second
// listener, so every render here states the flag instead of reading the local
// overlay's default; the cases below name the state they depend on.
const sharedGatewayFlag = "platform-shared-gateway";

async function overlay(
  name: string,
  features: Record<string, boolean>,
): Promise<Repository> {
  const base = withGatewayFlagsOff(await loadRepository(name));
  return {
    ...base,
    environment: {
      ...base.environment,
      features: {
        ...base.environment.features,
        [sharedGatewayFlag]: false,
        // ADR 0132: the deprecated alias listener is served only while platform-dns is on, and withGatewayFlagsOff pins it off, so these renders state it on.
        "platform-dns": true,
        ...features,
      },
    },
  };
}

function render(repository: Repository): string {
  const component = repository.catalog.components.find(
    (c) => c.name === "kore-platform-config",
  )!;
  return execFileSync(
    "helm",
    withAbsoluteChart(
      repository,
      component,
      helmTemplateArgs(repository, component),
    ),
    { cwd: repository.root, encoding: "utf8" },
  );
}

const enrolled = {
  [ingressFlag]: true,
  [agentgatewayMeshEnrollmentFlag]: true,
};

const podLabel = /labels: \{istio\.io\/dataplane-mode: ambient\}/;

test("agentgateway with the flag on labels the data-plane pod through the Gateway's infrastructure and keeps the node-port Service", async () => {
  const output = render(await overlay("local", enrolled));
  assert.match(output, /gatewayClassName: agentgateway/);
  assert.match(
    output,
    /infrastructure:\s+(?:#.*\s+)*labels: \{istio\.io\/dataplane-mode: ambient\}\s+parametersRef: \{group: agentgateway\.dev, kind: AgentgatewayParameters, name: kore-gateway-service\}/,
  );
  assert.match(
    output,
    new RegExp(`port: ${platform.gatewayPort}\\s+nodePort: 30443`),
  );
});

test("agentgateway with the flag on adds one PeerAuthentication that is permissive on the gateway's listener port only", async () => {
  const output = render(await overlay("local", enrolled));
  const docs = output
    .split(/^---$/m)
    .filter((doc) => doc.includes("kind: PeerAuthentication"));
  assert.equal(docs.length, 2);
  const gateway = docs.find((doc) => doc.includes("kore-gateway"))!;
  assert.match(gateway, /name: kore-gateway-listener\b/);
  assert.match(gateway, /namespace: kore-system/);
  assert.match(
    gateway,
    /selector:\s+matchLabels:\s+gateway\.networking\.k8s\.io\/gateway-name: kore-gateway/,
  );
  assert.match(gateway, /mtls: \{mode: STRICT\}/);
  assert.match(
    gateway,
    new RegExp(
      `portLevelMtls:\\s+"${platform.gatewayPort}": \\{mode: PERMISSIVE\\}`,
    ),
  );
  assert.doesNotMatch(gateway, /mode: DISABLE/);
  assert.equal(gateway.match(/PERMISSIVE/g)?.length, 1);
});

test("the namespace default stays STRICT and the default-deny and allow-https policies are unchanged", async () => {
  const off = render(await overlay("local", { [ingressFlag]: true }));
  const on = render(await overlay("local", enrolled));
  const keep = (output: string) =>
    output
      .split(/^---$/m)
      .filter((doc) =>
        /name: default\b|name: default-deny|name: gateway-allow-https/.test(
          doc,
        ),
      )
      .map((doc) => doc.trim());
  assert.equal(keep(on).length, 3);
  assert.deepEqual(keep(on), keep(off));
  assert.match(
    on,
    /name: default, namespace: kore-system\}\nspec: \{mtls: \{mode: STRICT\}\}/,
  );
});

test("the flag alone does nothing under the istio class: the render equals the flag-off render and the golden", async () => {
  const repository = await overlay("local", {
    [ingressFlag]: false,
    [agentgatewayMeshEnrollmentFlag]: true,
  });
  const golden = await readFile(
    `${repository.root}/tools/kore/src/platform/fixtures/platform-config.local.yaml`,
    "utf8",
  );
  assert.equal(render(repository), golden);
});

test("the agentgateway class without the flag renders no label and no gateway PeerAuthentication", async () => {
  const withoutFlag = render(
    await overlay("local", {
      [ingressFlag]: true,
      [agentgatewayMeshEnrollmentFlag]: false,
    }),
  );
  assert.doesNotMatch(withoutFlag, /dataplane-mode/);
  assert.doesNotMatch(withoutFlag, /portLevelMtls|PERMISSIVE/);
  const omitted = await overlay("local", { [ingressFlag]: true });
  const features = { ...omitted.environment.features };
  delete features[agentgatewayMeshEnrollmentFlag];
  assert.equal(
    render({ ...omitted, environment: { ...omitted.environment, features } }),
    withoutFlag,
  );
});

test("an overlay that sets no Gateway service still labels the pod, with no parameters reference", async () => {
  const output = render(await overlay("managed-example", enrolled));
  assert.match(output, podLabel);
  assert.doesNotMatch(output, /parametersRef|AgentgatewayParameters/);
  assert.match(output, /portLevelMtls:\s+"443": \{mode: PERMISSIVE\}/);
});

test("the Istio class never carries the pod label or the extra PeerAuthentication", async () => {
  const output = render(
    await overlay("managed-example", {
      [ingressFlag]: false,
      [agentgatewayMeshEnrollmentFlag]: true,
    }),
  );
  assert.doesNotMatch(output, /dataplane-mode|PERMISSIVE/);
});

const sharedOn = { [sharedGatewayFlag]: true };

test("with the shared Gateway on, agentgateway still labels the pod and publishes the Service on the standard port, forwarding to the listener port", async () => {
  const output = render(await overlay("local", { ...enrolled, ...sharedOn }));
  assert.match(output, /gatewayClassName: agentgateway/);
  assert.match(
    output,
    /infrastructure:\s+(?:#.*\s+)*labels: \{istio\.io\/dataplane-mode: ambient\}\s+parametersRef: \{group: agentgateway\.dev, kind: AgentgatewayParameters, name: kore-gateway-service\}/,
  );
  assert.match(
    output,
    new RegExp(
      `port: 443\\s+name: https-standard\\s+targetPort: ${platform.gatewayPort}\\s+nodePort: 30443`,
    ),
  );
  assert.doesNotMatch(
    output,
    new RegExp(`port: ${platform.gatewayPort}\\s+nodePort`),
  );
});

test("with the shared Gateway on, the gateway PeerAuthentication is still permissive on the listener port only", async () => {
  const output = render(await overlay("local", { ...enrolled, ...sharedOn }));
  const docs = output
    .split(/^---$/m)
    .filter((doc) => doc.includes("kind: PeerAuthentication"));
  assert.equal(docs.length, 2);
  const gateway = docs.find((doc) => doc.includes("kore-gateway"))!;
  assert.match(
    gateway,
    new RegExp(
      `portLevelMtls:\\s+"${platform.gatewayPort}": \\{mode: PERMISSIVE\\}`,
    ),
  );
  assert.equal(gateway.match(/PERMISSIVE/g)?.length, 1);
  assert.doesNotMatch(gateway, /mode: DISABLE/);
});

test("with the shared Gateway on, the flag alone still does nothing under the istio class beyond what the shared Gateway itself renders", async () => {
  const withEnrollment = render(
    await overlay("local", {
      [ingressFlag]: false,
      [agentgatewayMeshEnrollmentFlag]: true,
      ...sharedOn,
    }),
  );
  const without = render(
    await overlay("local", {
      [ingressFlag]: false,
      [agentgatewayMeshEnrollmentFlag]: false,
      ...sharedOn,
    }),
  );
  assert.equal(withEnrollment, without);
  assert.match(withEnrollment, /gatewayClassName: istio/);
  assert.doesNotMatch(withEnrollment, /dataplane-mode|PERMISSIVE/);
});
