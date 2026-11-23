// Docs: docs/decisions/0134-the-shared-gateway-admits-routes-only-from-platform-labelled-namespaces.md
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { test } from "vitest";
import {
  loadRepository,
  platformHelmArgs,
  platformPlan,
  type Repository,
  internalGateway,
} from "../../src/config/index.js";
import { helmTemplateArgs } from "../../src/platform/index.js";
import {
  applicationNamespaceManifest,
  withAbsoluteChart,
} from "../../src/testing/index.js";

// The shared Gateway admits a route only from a namespace labelled
// platform.kore.dev/shared-gateway="true" (ADR 0134). With every flag on, each
// chart that holds a route on the shared Gateway must have its namespace
// labelled by an owner: the platform chart, `kore app up`, the platform
// enrollment, or the golden-path ApplicationSet. These specs render the real
// charts and fail when a route's namespace is left out.

const label = "platform.kore.dev/shared-gateway";
const digest = `sha256:${"0".repeat(64)}`;

function allFlagsOn(repository: Repository): Repository {
  const features = Object.fromEntries(
    Object.keys(repository.environment.features ?? {}).map((flag) => [
      flag,
      true,
    ]),
  );
  return {
    ...repository,
    environment: {
      ...repository.environment,
      features: { ...features, "platform-shared-gateway": true },
    },
  };
}

function helm(args: string[], repository: Repository): string {
  return execFileSync("helm", args, { cwd: repository.root, encoding: "utf8" });
}

function documents(output: string): string[] {
  return output.split(/^---\s*$/m);
}

/** A route in a document: its namespace, falling back to the release's, and its parent Gateway. */
interface Route {
  name: string;
  namespace: string;
  gateway: string;
}

function routes(output: string, releaseNamespace: string): Route[] {
  return documents(output)
    .filter((doc) => /^kind: HTTPRoute/m.test(doc))
    .flatMap((doc) => {
      const name = /^ {2}name: (\S+)$/m.exec(doc)?.[1];
      const metadata = /^metadata:([\s\S]*?)^spec:/m.exec(doc)?.[1] ?? "";
      const inline = /^metadata: \{name: (\S+?)\}/m.exec(doc)?.[1];
      const namespace = /^ {2}namespace: (\S+)$/m.exec(metadata)?.[1];
      const parents = [
        ...doc.matchAll(/name: ([\w-]+),? ?namespace: ([\w-]+)/g),
        ...doc.matchAll(/name: ([\w-]+)\n\s+namespace: ([\w-]+)/g),
      ];
      const resolved = name ?? inline;
      assert.ok(resolved, "an HTTPRoute has a name");
      return parents.map((parent) => ({
        name: resolved,
        namespace: namespace ?? releaseNamespace,
        gateway: `${parent[2]}/${parent[1]}`,
      }));
    });
}

function labelledNamespaces(output: string): string[] {
  return documents(output)
    .filter(
      (doc) =>
        /^kind: Namespace/m.test(doc) &&
        new RegExp(`^ {4}${label.replaceAll(".", "\\.")}: "true"`, "m").test(
          doc.replace(/(labels: \{[^}]*)\}/, "$1}").replace(/, /g, "\n    "),
        ),
    )
    .map((doc) => /^ {2}name: (\S+)$/m.exec(doc)![1]!);
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

function renderReference(repository: Repository): string {
  return helm(
    [
      "template",
      "reference",
      join(repository.root, "apps/reference/charts/workload"),
      "--namespace",
      "reference",
      "--set-string",
      `platform.gateway.name=${internalGateway(repository.environment).name}`,
      "--set-string",
      `platform.gateway.namespace=${internalGateway(repository.environment).namespace}`,
      "--set-string",
      `platform.gateway.hostname=${platformPlan(repository.environment).domain}`,
    ],
    repository,
  );
}

function renderWorkload(repository: Repository): string {
  const { name } = component(repository, "kore-golden-path-delivery");
  const { domain, organizationId } = platformPlan(repository.environment);
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
      `ingress.host=web.${organizationId}.${domain}`,
      "--set-string",
      "ingress.gatewayClassName=agentgateway",
      ...platformHelmArgs(repository.environment, name),
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
      // What kore passes the chart while the flag is on (platform/helm.ts).
      "--set",
      "sharedGateway=true",
      ...platformHelmArgs(repository.environment, name),
    ],
    repository,
  );
}

function renderBackstage(repository: Repository): string {
  const backstage = component(repository, "kore-platform-backstage");
  return helm(
    [
      "template",
      "kore-platform-backstage",
      join(repository.root, "infra/charts/platform-backstage"),
      "--namespace",
      backstage.namespace,
      "--values",
      join(
        repository.root,
        "infra/environments/common/values/platform-backstage.yaml",
      ),
      "--set-string",
      "gatewayClassName=agentgateway",
      ...platformHelmArgs(repository.environment, backstage.name),
    ],
    repository,
  );
}

/** Every namespace some owner labels while the flag is on. */
function labelled(repository: Repository, delivery: string): Set<string> {
  const { components } = repository.catalog;
  const namespaces = new Set<string>([
    ...labelledNamespaces(renderConfig(repository)),
    // `kore app up` applies the namespace for each application it installs.
    ...["reference"].filter((name) =>
      applicationNamespaceManifest(repository, name).includes(
        `${label}: "true"`,
      ),
    ),
    // The platform enrollment labels the namespace of each component that says so.
    ...components.filter((c) => c.sharedGatewayRoutes).map((c) => c.namespace),
  ]);
  // The ApplicationSet labels each namespace it creates for a delivered Service.
  if (
    new RegExp(
      `managedNamespaceMetadata:\\s+labels:\\s+${label.replaceAll(".", "\\.")}: "true"`,
    ).test(delivery)
  ) {
    namespaces.add("web--local");
  }
  return namespaces;
}

function onSharedGateway(repository: Repository, found: Route[]): Route[] {
  const gateway = internalGateway(repository.environment);
  return found.filter(
    (route) => route.gateway === `${gateway.namespace}/${gateway.name}`,
  );
}

test("with every flag on, each chart's route on the shared Gateway sits in a namespace some owner labels", async () => {
  const repository = allFlagsOn(await loadRepository("local"));
  const delivery = renderDelivery(repository);
  const attached = onSharedGateway(repository, [
    ...routes(renderReference(repository), "reference"),
    ...routes(renderWorkload(repository), "web--local"),
    ...routes(renderBackstage(repository), "backstage"),
  ]);
  assert.deepEqual(
    attached.map((route) => `${route.namespace}/${route.name}`).sort(),
    [
      "backstage/backstage-shared",
      "reference/reference",
      "web--local/web-shared",
    ],
  );
  const owned = labelled(repository, delivery);
  const unlabelled = attached.filter((route) => !owned.has(route.namespace));
  assert.deepEqual(
    unlabelled,
    [],
    `route namespaces the shared Gateway would not admit; label them or move the route (ADR 0134)`,
  );
}, 90_000);

test("a route whose namespace no owner labels is reported, so an unlabelled namespace fails the check", async () => {
  const repository = allFlagsOn(await loadRepository("local"));
  const stray = onSharedGateway(
    repository,
    routes(renderReference(repository), "unlabelled-team"),
  );
  const owned = labelled(repository, renderDelivery(repository));
  assert.deepEqual(
    stray
      .filter((route) => !owned.has(route.namespace))
      .map((r) => r.namespace),
    ["unlabelled-team"],
  );
}, 90_000);

test("with platform-shared-gateway off, the reference namespace is applied with no shared Gateway label", async () => {
  const repository = await loadRepository("local");
  const off = {
    ...repository,
    environment: {
      ...repository.environment,
      features: {
        ...repository.environment.features,
        "platform-shared-gateway": false,
      },
    },
  };
  assert.equal(
    applicationNamespaceManifest(off, "reference"),
    `apiVersion: v1\nkind: Namespace\nmetadata:\n  name: reference\n  labels:\n    istio.io/dataplane-mode: ambient\n    policy.sigstore.dev/include: "true"\n`,
  );
}, 30_000);
