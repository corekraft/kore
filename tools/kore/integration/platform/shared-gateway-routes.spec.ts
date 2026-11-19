// Docs: docs/decisions/0133-the-platform-owns-the-gateway-its-listeners-and-its-certificate-charts-own-routes-only.md
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { test } from "vitest";
import {
  componentValues,
  loadRepository,
  platformHelmArgs,
  platformPlan,
  type Repository,
} from "../../src/config/index.js";
import { helmTemplateArgs, routeHostErrors } from "../../src/platform/index.js";
import { withAbsoluteChart } from "../../src/testing/index.js";
import { escapeRegExp } from "../local-platform-support.js";

// With platform-shared-gateway on, the golden-path and portal charts attach a
// route to the shared Gateway beside the Gateway each creates today. Off, both
// render what they rendered before. These specs render the real charts.

const digest = `sha256:${"0".repeat(64)}`;

function withSharedGateway(repository: Repository, on: boolean): Repository {
  return {
    ...repository,
    environment: {
      ...repository.environment,
      features: {
        ...repository.environment.features,
        "platform-shared-gateway": on,
      },
    },
  };
}

function helm(args: string[], repository: Repository): string {
  return execFileSync("helm", args, { cwd: repository.root, encoding: "utf8" });
}

function component(repository: Repository, name: string) {
  const found = repository.catalog.components.find((c) => c.name === name);
  assert.ok(found, `${name} is in the catalog`);
  return found;
}

function renderConfig(repository: Repository): string {
  const config = component(repository, "kore-platform-config");
  return helm(
    withAbsoluteChart(repository, config, helmTemplateArgs(repository, config)),
    repository,
  );
}

// The portal's schema is closed to the feature flags kore passes the other
// charts, so it renders from its value files and the values kore derives.
function renderBackstage(repository: Repository): string {
  const backstage = component(repository, "kore-platform-backstage");
  return helm(
    [
      "template",
      "kore-platform-backstage",
      join(repository.root, "infra/charts/platform-backstage"),
      "--namespace",
      "backstage",
      ...componentValues(repository, backstage).flatMap((file) => [
        "--values",
        join(repository.root, file),
      ]),
      "--set-string",
      "gatewayClassName=agentgateway",
      ...platformHelmArgs(repository.environment, backstage.name),
    ],
    repository,
  );
}

// The ApplicationSet hands the workload chart `ingress.*`; the delivery chart's
// own values carry the same keys, so the arguments kore gives it render the
// workload for one Service of the named organization.
function renderWorkload(repository: Repository, host: string): string {
  const { name } = component(repository, "kore-golden-path-delivery");
  const sharedArgs = platformHelmArgs(repository.environment, name);
  return helm(
    [
      "template",
      "web",
      join(repository.root, "infra/charts/golden-path-workload"),
      "--namespace",
      "web--local",
      "--set-string",
      "service=web",
      "--set-string",
      `frontend.image=registry.example/web@${digest}`,
      "--set-string",
      `bff.image=registry.example/web-bff@${digest}`,
      "--set-string",
      `ingress.host=${host}`,
      "--set-string",
      "ingress.gatewayClassName=agentgateway",
      ...sharedArgs,
    ],
    repository,
  );
}

function renderDelivery(repository: Repository): string {
  const { name } = component(repository, "kore-golden-path-delivery");
  return helm(
    [
      "template",
      name,
      join(repository.root, "infra/charts/golden-path-delivery"),
      "--set-string",
      "repoURL=https://example.com/kore.git",
      "--set-string",
      `revision=${"0".repeat(40)}`,
      "--set-string",
      "environment=local",
      "--set-json",
      `templateImages=${JSON.stringify({
        "static-frontend": { image: "registry.example/f", digest },
        "kotlin-bff": { image: "registry.example/b", digest },
      })}`,
      "--set-string",
      `ingress.platformDomain=${platformPlan(repository.environment).domain}`,
      "--set-string",
      "ingress.gatewayClassName=agentgateway",
      ...platformHelmArgs(repository.environment, name),
    ],
    repository,
  );
}

function sharedRoute(output: string, name: string): string {
  const route = output
    .split(/^---\s*$/m)
    .find(
      (doc) =>
        /^kind: HTTPRoute/m.test(doc) &&
        new RegExp(`^ {2}name: ${name}$`, "m").test(doc),
    );
  assert.ok(route, `an HTTPRoute named ${name} renders`);
  return route;
}

function shared(repository: Repository) {
  const { gateway } = repository.environment;
  const { domain, organizationId } = platformPlan(repository.environment);
  return { gateway, domain, organizationId };
}

test("with platform-shared-gateway off the portal renders only its own Gateway and route", async () => {
  const repository = withSharedGateway(await loadRepository("local"), false);
  const output = renderBackstage(repository);
  assert.match(output, /kind: Gateway\s+metadata:\s+name: backstage\n/);

  assert.match(
    sharedRoute(output, "backstage"),
    /parentRefs:\s+- kind: Gateway\s+name: backstage\n/,
  );
  assert.doesNotMatch(output, /backstage-shared|kore-gateway|sharedGateway/);
}, 30_000);

test("with platform-shared-gateway on the portal keeps its own Gateway and gains a route on the shared Gateway for its name under the organization", async () => {
  const repository = withSharedGateway(await loadRepository("local"), true);
  const { gateway, domain, organizationId } = shared(repository);
  const output = renderBackstage(repository);
  assert.match(output, /kind: Gateway\s+metadata:\s+name: backstage\n/);
  assert.match(
    output,
    new RegExp(`hostname: "backstage\\.${escapeRegExp(domain)}"`),
  );
  const route = sharedRoute(output, "backstage-shared");
  assert.match(
    route,
    new RegExp(
      `parentRefs:\\s+- kind: Gateway\\s+name: ${gateway.name}\\s+namespace: ${gateway.namespace}`,
    ),
  );
  assert.match(
    route,
    new RegExp(
      `hostnames:\\s+- "backstage\\.${escapeRegExp(`${organizationId}.${domain}`)}"`,
    ),
  );
  assert.match(route, /backendRefs:\s+- name: backstage\s+port: 80/);
}, 30_000);

test("with platform-shared-gateway off a delivered Service renders only its own Gateway, certificate and route", async () => {
  const repository = withSharedGateway(await loadRepository("local"), false);
  const { domain, organizationId } = shared(repository);
  const output = renderWorkload(repository, `web.${organizationId}.${domain}`);
  assert.match(output, /kind: Gateway/);
  assert.match(output, /kind: Certificate/);
  assert.doesNotMatch(output, /web-shared|kore-gateway|sharedGateway/);
  assert.doesNotMatch(renderDelivery(repository), /sharedGateway/);
}, 30_000);

test("with platform-shared-gateway on a delivered Service under the organization renders no Gateway or certificate of its own, only its route on the shared Gateway", async () => {
  const repository = withSharedGateway(await loadRepository("local"), true);
  const { gateway, domain, organizationId } = shared(repository);
  const host = `web.${organizationId}.${domain}`;
  const output = renderWorkload(repository, host);
  assert.doesNotMatch(output, /^kind: Gateway$/m);
  assert.doesNotMatch(output, /^kind: Certificate$/m);
  assert.doesNotMatch(output, /web-tls/);
  assert.doesNotMatch(output, /^ {2}name: web$/m);
  assert.equal(output.match(/kind: HTTPRoute/g)?.length, 1);
  const route = sharedRoute(output, "web-shared");
  assert.match(
    route,
    new RegExp(
      `parentRefs:\\s+- kind: Gateway\\s+name: ${gateway.name}\\s+namespace: ${gateway.namespace}`,
    ),
  );
  assert.match(route, new RegExp(`hostnames:\\s+- "${escapeRegExp(host)}"`));
  assert.match(
    route,
    /value: \/api\}\s+backendRefs:\s+- \{name: web-bff, port: 80\}/,
  );
  assert.match(route, /- \{name: web-frontend, port: 80\}/);
}, 30_000);

test("a delivered Service whose host the shared listener does not serve gets no shared route", async () => {
  const repository = withSharedGateway(await loadRepository("local"), true);
  const { domain, organizationId } = shared(repository);
  const output = renderWorkload(
    repository,
    `web.not-${organizationId}.${domain}`,
  );
  assert.match(output, /kind: Gateway\s+metadata:\s+name: web\n/);
  assert.match(output, /kind: Certificate/);
  assert.match(output, /^ {2}name: web$/m);
  assert.doesNotMatch(output, /web-shared/);
}, 30_000);

test("the ApplicationSet hands each Service the shared Gateway only while the flag is on", async () => {
  const on = renderDelivery(
    withSharedGateway(await loadRepository("local"), true),
  );
  const { gateway, domain, organizationId } = shared(
    withSharedGateway(await loadRepository("local"), true),
  );
  assert.match(
    on,
    new RegExp(`ingress.sharedGateway.name\\s+value: "${gateway.name}"`),
  );
  assert.match(
    on,
    new RegExp(
      `ingress.sharedGateway.namespace\\s+value: "${gateway.namespace}"`,
    ),
  );
  assert.match(
    on,
    new RegExp(
      `ingress.sharedGateway.domain\\s+value: "${escapeRegExp(`${organizationId}.${domain}`)}"`,
    ),
  );
}, 30_000);

test("every rendered shared route host has a listener hostname on the shared Gateway that serves it", async () => {
  const repository = withSharedGateway(await loadRepository("local"), true);
  const { gateway, domain, organizationId } = shared(repository);
  const rendered = [
    renderConfig(repository),
    renderBackstage(repository),
    renderWorkload(repository, `web.${organizationId}.${domain}`),
  ].join("\n---\n");
  assert.match(rendered, /backstage-shared/);
  assert.match(rendered, /name: web-shared/);
  assert.deepEqual(routeHostErrors(rendered, gateway), []);
}, 60_000);

test("a shared route for a domain the shared Gateway has no listener for fails the host check, naming the host", async () => {
  const repository = withSharedGateway(await loadRepository("local"), true);
  const { gateway } = shared(repository);
  const rendered = [
    renderConfig(repository),
    renderBackstage({
      ...repository,
      environment: {
        ...repository.environment,
        platform: { domain: "moved.example", organizationId: "other" },
      },
    }),
  ].join("\n---\n");
  const errors = routeHostErrors(rendered, gateway);
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /host backstage\.other\.moved\.example/);
}, 60_000);
