import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "vitest";
import {
  enabledComponents,
  gatewayClassName,
  ingressFlag,
  type Repository,
} from "../../src/config/index.js";
import { loadRepository, validateRepository } from "../../src/config/index.js";
import {
  helmTemplateArgs,
  withAbsoluteChart,
} from "../../src/platform/helm.js";

async function localWith(features: unknown): Promise<Repository> {
  const base = await loadRepository("local");
  return {
    ...base,
    environment: { ...base.environment, features } as never,
  };
}

function platformConfig(repository: Repository) {
  return repository.catalog.components.find(
    (c) => c.name === "kore-platform-config",
  )!;
}

function render(repository: Repository): string {
  const component = platformConfig(repository);
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

test("the ingress flag is off in every overlay and picks the istio class", async () => {
  for (const name of ["local", "managed-example"]) {
    const base = await loadRepository(name);
    assert.equal(gatewayClassName(base.environment), "istio");
  }
  const flagged = await localWith({ [ingressFlag]: true });
  assert.equal(gatewayClassName(flagged.environment), "agentgateway");
});

test("the local overlay declares the ingress flag, set off", async () => {
  const base = await loadRepository("local");
  assert.equal(base.environment.features?.[ingressFlag], false);
});

test("with the flag off the platform-config render is byte-identical to today", async () => {
  const repository = await loadRepository("local");
  const golden = await readFile(
    `${repository.root}/tools/kore/src/platform/fixtures/platform-config.local.yaml`,
    "utf8",
  );
  assert.equal(render(repository), golden);
});

test("with the flag on the Gateway class changes and its Service is published through agentgateway's own parameters", async () => {
  const off = render(await localWith({ [ingressFlag]: false }));
  const on = render(await localWith({ [ingressFlag]: true }));
  assert.match(off, /gatewayClassName: istio/);
  assert.match(off, /kind: ConfigMap\s+metadata:\s+name: kore-gateway-service/);
  assert.match(on, /gatewayClassName: agentgateway/);
  assert.doesNotMatch(on, /gatewayClassName: istio/);
  // The Istio overlay is a ConfigMap; agentgateway reads the same Service
  // settings from its AgentgatewayParameters, so the node port is kept.
  assert.doesNotMatch(on, /kind: ConfigMap/);
  assert.match(
    on,
    /parametersRef: \{group: agentgateway\.dev, kind: AgentgatewayParameters, name: kore-gateway-service\}/,
  );
  assert.match(on, /kind: AgentgatewayParameters/);
  assert.match(on, /type: NodePort/);
  assert.match(on, /port: 8443\s+nodePort: 30443/);
});

test("with the flag on, an overlay that sets no Gateway service renders no parameters resource", async () => {
  const base = await loadRepository("managed-example");
  const on = render({
    ...base,
    environment: {
      ...base.environment,
      features: { ...base.environment.features, [ingressFlag]: true },
    },
  });
  assert.match(on, /gatewayClassName: agentgateway/);
  assert.doesNotMatch(on, /AgentgatewayParameters|parametersRef/);
});

test("no agentgateway release is issued with the flag off, and both are with it on", async () => {
  const released = async (on: boolean) =>
    enabledComponents(await localWith({ [ingressFlag]: on }))
      .map((c) => c.name)
      .filter((name) => /agentgateway/.test(name));
  assert.deepEqual(await released(false), []);
  assert.deepEqual(await released(true), ["agentgateway-crds", "agentgateway"]);
});

test("the chart template does not hard-code a GatewayClass", async () => {
  const repository = await loadRepository("local");
  const gateway = await readFile(
    `${repository.root}/infra/charts/platform-config/templates/gateway.yaml`,
    "utf8",
  );
  assert.doesNotMatch(gateway, /gatewayClassName:\s*istio/);
  assert.match(
    gateway,
    /gatewayClassName:\s*{{ .*\.Values\.gateway\.className/,
  );
});

test("a malformed ingress flag fails validation naming the flag and the fix", async () => {
  await assert.rejects(
    validateRepository(await localWith({ [ingressFlag]: "yes" })),
    /environment\.features\.ingress-agentgateway must be true or false/,
  );
});

test("turning the flag back off restores the Istio class and overlay and drops agentgateway's parameters", async () => {
  const on = render(await localWith({ [ingressFlag]: true }));
  const off = render(await localWith({ [ingressFlag]: false }));
  assert.match(on, /AgentgatewayParameters/);
  assert.doesNotMatch(off, /AgentgatewayParameters|agentgateway/);
  assert.match(off, /gatewayClassName: istio/);
  assert.match(off, /kind: ConfigMap\s+metadata:\s+name: kore-gateway-service/);
});
