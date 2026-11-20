import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { test } from "vitest";
import {
  findRoot,
  loadRepository,
  type Repository,
} from "../../src/config/index.js";
import { helmTemplateArgs } from "../../src/platform/index.js";
import { withAbsoluteChart } from "../../src/testing/index.js";
import {
  lock,
  namespaces,
} from "./platform-config-delivery-chart-support.js";
import { escapeRegExp, localPlatform } from "../local-platform-support.js";

// Docs: docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md

const run = promisify(execFile);
const platform = await localPlatform();

/**
 * The local overlay with a deprecated alias declared, and platform-dns set as
 * given. With the flag off the domain is the overlay's own and the alias is a
 * valid name of its own, so only the flag keeps the alias out of the render.
 * With the flag on the domain is an activated name and the alias is the overlay's
 * domain, the shape the activation will use.
 */
async function withAlias(
  platformDns: boolean,
): Promise<{ repository: Repository; domain: string; alias: string }> {
  const base = await loadRepository("local");
  const own = base.environment.platform.domain;
  const domain = platformDns ? `activated.${own}` : own;
  const alias = platformDns ? own : `alias.${own}`;
  return {
    domain,
    alias,
    repository: {
      ...base,
      environment: {
        ...base.environment,
        platform: {
          domain,
          organizationId: "platform",
          deprecatedAlias: alias,
        },
        features: { ...base.environment.features, "platform-dns": platformDns },
      } as never,
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

const golden = async (name: string) =>
  readFile(
    `${await findRoot()}/tools/kore/src/platform/fixtures/${name}`,
    "utf8",
  );

test("with platform-dns off a declared alias leaves the local certificate byte-identical to the golden rendered from main, which carries no alias", async () => {
  const { repository } = await withAlias(false);
  assert.equal(
    certificateRender(repository),
    await golden("platform-certificate.local.yaml"),
  );
});

test("with platform-dns off a declared alias leaves the delivery values byte-identical to the golden rendered from main", async () => {
  const chart = `${await findRoot()}/infra/charts/platform-config-delivery`;
  assert.equal(
    await deliveryRender(chart),
    await golden("platform-config-delivery.local.yaml"),
  );
});

test("with platform-dns on the local certificate names the alias beside the domain, so the alias listener is served by the same certificate", async () => {
  const { repository, domain, alias } = await withAlias(true);
  assert.match(
    certificateRender(repository),
    new RegExp(`- "${escapeRegExp(domain)}"\\n\\s+- "${escapeRegExp(alias)}"`),
  );
});
