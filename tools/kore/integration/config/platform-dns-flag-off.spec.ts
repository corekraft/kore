import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { test } from "vitest";
import {
  chartDeliveryValues,
  findRoot,
  loadRepository,
  type Repository,
} from "../../src/config/index.js";
import { helmTemplateArgs } from "../../src/platform/index.js";
import { withAbsoluteChart } from "../../src/testing/index.js";
import { lock, namespaces } from "./platform-config-delivery-chart-support.js";
import { localPlatform } from "../local-platform-support.js";

// Docs: docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md

const run = promisify(execFile);
const platform = await localPlatform();

/** The local overlay with platform-dns set as given; the domain is the overlay's own. */
async function withPlatformDns(platformDns: boolean): Promise<Repository> {
  const base = await loadRepository("local");
  return {
    ...base,
    environment: {
      ...base.environment,
      features: { ...base.environment.features, "platform-dns": platformDns },
    },
  };
}

function certificateRender(repository: Repository): string {
  const component = repository.catalog.components.find(
    (c) => c.name === "kore-local-tls",
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

/** The delivery chart rendered with the arguments the delivery spec uses, from the given chart directory. */
async function deliveryRender(chart: string): Promise<string> {
  const { stdout } = await run("helm", [
    "template",
    "platform-config-delivery",
    chart,
    "--set-json",
    `charts=${JSON.stringify(lock())}`,
    "--set-json",
    `namespaces=${JSON.stringify(await namespaces())}`,
    "--set-string",
    "gatewayClassName=agentgateway",
    "--set-string",
    `platformDomain=${platform.domain}`,
    "--set-string",
    `platformHostname=*.platform.${platform.domain}`,
  ]);
  return stdout;
}

/** The release lock document the delivery values are built from. */
const lockFile = () => ({ version: 1, entries: lock() });

const golden = async (name: string) =>
  readFile(
    `${await findRoot()}/tools/kore/src/platform/fixtures/${name}`,
    "utf8",
  );

test("with platform-dns off the local certificate is byte-identical to the golden rendered from main", async () => {
  assert.equal(
    certificateRender(await withPlatformDns(false)),
    await golden("platform-certificate.local.yaml"),
  );
});

test("the delivery render is byte-identical to the golden rendered from main, and no flag state hands it a deprecated alias (ADR 0176)", async () => {
  const chart = `${await findRoot()}/infra/charts/platform-config-delivery`;
  assert.equal(
    await deliveryRender(chart),
    await golden("platform-config-delivery.local.yaml"),
  );
  for (const platformDns of [false, true]) {
    assert.equal(
      "platformDeprecatedAlias" in
        chartDeliveryValues(await withPlatformDns(platformDns), lockFile()),
      false,
    );
  }
});

test("with platform-dns on the local certificate names the platform domain only, so no alias name is served (ADR 0176)", async () => {
  assert.match(
    certificateRender(await withPlatformDns(true)),
    new RegExp(
      `dnsNames:\\n\\s+- "${platform.domain.replaceAll(".", "\\.")}"\\n\\s+issuerRef:`,
    ),
  );
});
