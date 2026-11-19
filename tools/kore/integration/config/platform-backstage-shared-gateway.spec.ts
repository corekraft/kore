// Docs: docs/decisions/0133-the-platform-owns-the-gateway-its-listeners-and-its-certificate-charts-own-routes-only.md
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";
import {
  findRoot,
  loadRepository,
  platformHelmArgs,
  type Repository,
} from "../../src/config/index.js";
import { escapeRegExp, localPlatform } from "../local-platform-support.js";

// With platform-shared-gateway on, the portal also attaches one route to the
// platform Gateway for the organization's host. These specs state the flag on
// and off instead of reading the local overlay's default.

const platform = await localPlatform();
const domain = escapeRegExp(platform.domain);
const run = promisify(execFile);
const sharedGatewayFlag = "platform-shared-gateway";

async function render(
  sharedGateway: boolean | undefined,
  gatewayClassName?: string,
): Promise<string> {
  const root = await findRoot();
  const base = await loadRepository("local");
  const features: Record<string, boolean> = { ...base.environment.features };
  if (sharedGateway === undefined) {
    delete features[sharedGatewayFlag];
  } else {
    features[sharedGatewayFlag] = sharedGateway;
  }
  const repository: Repository = {
    ...base,
    environment: { ...base.environment, features },
  };
  const component = repository.catalog.components.find(
    (c) => c.name === "kore-platform-backstage",
  );
  const values = [
    ...(component?.values ?? []),
    ...(repository.environment.componentValues?.["kore-platform-backstage"] ??
      []),
  ].flatMap((file) => ["--values", join(root, file)]);
  const { stdout } = await run("helm", [
    "template",
    "kore-platform-backstage",
    join(root, "infra/charts/platform-backstage"),
    "--namespace",
    "backstage",
    ...values,
    ...platformHelmArgs(repository.environment, "kore-platform-backstage"),
    ...(gatewayClassName === undefined
      ? []
      : ["--set-string", `gatewayClassName=${gatewayClassName}`]),
  ]);
  return stdout;
}

const documents = (rendered: string, kind: string): string[] =>
  rendered
    .split(/^---$/m)
    .filter((part) => new RegExp(`^kind: ${kind}$`, "m").test(part));

test("with the flag on the portal adds one route to the platform Gateway for the organization's host, beside its own, and it reaches only the sign-in proxy", async () => {
  const rendered = await render(true, "agentgateway");
  const routes = documents(rendered, "HTTPRoute");
  assert.equal(routes.length, 2);
  const own = routes.find((r) => /^ {2}name: backstage$/m.test(r))!;
  const shared = routes.find((r) => /^ {2}name: backstage-shared$/m.test(r))!;
  assert.match(own, /kind: Gateway\n\s+name: backstage\n/);
  assert.match(
    shared,
    /parentRefs:\n\s+- kind: Gateway\n\s+name: kore-gateway\n\s+namespace: kore-system/,
  );
  assert.match(
    shared,
    new RegExp(`hostnames:\\n\\s+- "backstage\\.platform\\.${domain}"`),
  );
  assert.match(shared, /name: backstage\n\s+port: 80/);
  assert.equal(shared.includes("7007"), false);
  assert.equal(/name: backstage-db/.test(shared), false);
  assert.equal(documents(rendered, "Gateway").length, 1);
  assert.equal(documents(rendered, "Certificate").length, 1);
  assert.equal(documents(rendered, "Service").length, 1);
  assert.equal(/kind: (NodePort|LoadBalancer)/.test(rendered), false);
});

test("with the flag on and no gateway class the portal renders the shared route alone, owning no Gateway or certificate", async () => {
  const rendered = await render(true);
  const routes = documents(rendered, "HTTPRoute");
  assert.equal(routes.length, 1);
  assert.match(routes[0]!, /^ {2}name: backstage-shared$/m);
  for (const kind of ["Gateway", "Certificate"]) {
    assert.equal(documents(rendered, kind).length, 0, kind);
  }
});

test("with the flag off the portal renders no shared route, and an omitted flag renders the same", async () => {
  const off = await render(false, "agentgateway");
  assert.doesNotMatch(off, /backstage-shared/);
  assert.doesNotMatch(off, /name: kore-gateway/);
  assert.equal(documents(off, "HTTPRoute").length, 1);
  assert.equal(await render(undefined, "agentgateway"), off);
  assert.equal(documents(await render(false), "HTTPRoute").length, 0);
});
