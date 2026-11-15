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
import { withAbsoluteChart } from "../../src/testing/index.js";

async function overlay(
  name: string,
  features: Record<string, boolean>,
): Promise<Repository> {
  const base = await loadRepository(name);
  return {
    ...base,
    environment: {
      ...base.environment,
      features: { ...base.environment.features, ...features },
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
  assert.match(output, /port: 8443\s+nodePort: 30443/);
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
  assert.match(gateway, /portLevelMtls:\s+"8443": \{mode: PERMISSIVE\}/);
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
