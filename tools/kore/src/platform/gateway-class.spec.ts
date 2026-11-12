import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "vitest";
import {
  gatewayClassName,
  ingressFlag,
  type Repository,
} from "../config/index.js";
import { loadRepository, validateRepository } from "../config/config.js";
import { helmTemplateArgs, withAbsoluteChart } from "./helm.js";

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

test("with the flag on only the Gateway class changes", async () => {
  const off = render(await localWith({ [ingressFlag]: false }));
  const on = render(await localWith({ [ingressFlag]: true }));
  assert.match(off, /gatewayClassName: istio/);
  assert.equal(
    on,
    off.replace("gatewayClassName: istio", "gatewayClassName: agentgateway"),
  );
});

test("no agentgateway release is issued with the flag off", async () => {
  const repository = await loadRepository("local");
  assert.ok(
    !repository.catalog.components.some((c) => /agentgateway/.test(c.name)),
  );
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
