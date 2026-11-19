import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  enabledComponents,
  findRoot,
  loadRepository,
  platformArgocdDeliveryFlag,
  type Repository,
} from "../../src/config/index.js";
import { composeChartDelivery } from "../../src/platform/index.js";
import { localPlatform } from "../local-platform-support.js";

const platform = await localPlatform();

const run = promisify(execFile);

// Kinds the six charts render that live in a namespace. A kind in neither this
// list nor the AppProject whitelist fails the spec, so a new one is decided.
export const namespacedKinds = new Set([
  "Deployment",
  "ConfigMap",
  "Service",
  "ServiceAccount",
  "Certificate",
  "Gateway",
  "AuthorizationPolicy",
  "PeerAuthentication",
  "Config",
]);

async function yamlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory()
        ? yamlFiles(join(dir, entry.name))
        : Promise.resolve(
            entry.name.endsWith(".yaml") ? [join(dir, entry.name)] : [],
          ),
    ),
  );
  return nested.flat();
}

export const handedOver = [
  "opa-authorizer",
  "kore-postgresql-api",
  "kore-policy-templates",
  "kore-policy-constraints",
  "kore-local-tls",
  "kore-platform-config",
];
export const registry = "ghcr.io/corekraft/kore/charts";
export const signer =
  "https://github.com/corekraft/kore/.github/workflows/release.yaml@refs/tags/v1.0.0";

export const digestOf = (name: string) =>
  `sha256:${(handedOver.indexOf(name) + 1).toString(16).repeat(64)}`;

export const lock = (names: string[] = handedOver) =>
  Object.fromEntries(
    names.map((name) => [
      name,
      {
        chart: `${registry}/${name}`,
        version: "0.0.0-0123456789ab",
        digest: digestOf(name),
        signer,
      },
    ]),
  );

export async function namespaces(): Promise<Record<string, string>> {
  const repository = await loadRepository("local");
  return Object.fromEntries(
    handedOver.map((name) => {
      const component = repository.catalog.components.find(
        (c) => c.name === name,
      );
      return [name, component!.namespace];
    }),
  );
}

export async function render(...set: string[]): Promise<string[]> {
  const root = await findRoot();
  const { stdout } = await run("helm", [
    "template",
    "platform-config-delivery",
    join(root, "infra/charts/platform-config-delivery"),
    "--set-json",
    `charts=${JSON.stringify(lock())}`,
    "--set-json",
    `namespaces=${JSON.stringify(await namespaces())}`,
    "--set-string",
    "gatewayClassName=agentgateway",
    "--set-string",
    `platformDomain=${platform.domain}`,
    ...set,
  ]);
  return stdout.split("\n---\n").filter((doc) => /^kind:/m.test(doc));
}

export async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return String((error as { stderr?: string }).stderr);
  }
  return assert.fail("expected the render to fail");
}

/** The local repository with every flag the catalog gates a component on set to `on`, Argo CD delivery staying on. */
export async function withFlags(on: boolean): Promise<Repository> {
  const repository = await loadRepository("local");
  const flags = new Set([
    ...Object.keys(repository.environment.features ?? {}),
    ...repository.catalog.components.flatMap((c) =>
      c.featureFlag === undefined ? [] : [c.featureFlag],
    ),
  ]);
  return {
    ...repository,
    environment: {
      ...repository.environment,
      features: {
        ...Object.fromEntries([...flags].map((flag) => [flag, on])),
        [platformArgocdDeliveryFlag]: true,
      },
    },
  };
}

/** The repository with the delivery values `kore` composes from a lock covering every argocd-owned component. */
export async function composed(repository: Repository): Promise<Repository> {
  const digest = `sha256:${"a".repeat(64)}`;
  const dir = await mkdtemp(join(tmpdir(), "kore-delivery-schema-"));
  const lockPath = join(dir, "platform-charts.lock.json");
  await writeFile(
    lockPath,
    JSON.stringify({
      version: 1,
      entries: Object.fromEntries(
        argocdOwned(repository).map((name) => [
          name,
          { chart: `registry.example.com/charts/${name}`, digest },
        ]),
      ),
    }),
  );
  return composeChartDelivery(repository, lockPath);
}

/** The names of the enabled components Argo CD owns. */
export const argocdOwned = (repository: Repository): string[] =>
  enabledComponents(repository)
    .filter((c) => c.owner === "argocd")
    .map((c) => c.name);

/** Renders the delivery chart with the values `kore` composes, so Helm checks them against the chart's schema. */
export async function renderDelivery(repository: Repository): Promise<{
  handedOver: string[];
  applications: string[];
  docs: string[];
}> {
  const { chartDelivery } = await composed(repository);
  assert.ok(chartDelivery);
  const { stdout } = await run("helm", [
    "template",
    "kore-config-delivery",
    join(await findRoot(), "infra/charts/platform-config-delivery"),
    "--set-json",
    `charts=${JSON.stringify(chartDelivery.charts)}`,
    "--set-json",
    `namespaces=${JSON.stringify(chartDelivery.namespaces)}`,
    "--set-string",
    `gatewayClassName=${chartDelivery.gatewayClassName}`,
    "--set-string",
    `platformDomain=${chartDelivery.platformDomain}`,
    "--set-json",
    `releaseValues=${JSON.stringify(chartDelivery.releaseValues)}`,
  ]);
  return {
    handedOver: argocdOwned(repository),
    docs: stdout.split("\n---\n").filter((doc) => /^kind:/m.test(doc)),
    applications: [
      ...stdout.matchAll(
        /^kind: Application\n {0}metadata:\n {2}name: (.+)$/gm,
      ),
    ].map((m) => m[1]!),
  };
}

export type Resource = {
  group: string;
  kind: string;
  /** The `metadata.namespace` the manifest sets, when it sets one. */
  namespace?: string;
};

const resourcesOf = (text: string): Resource[] =>
  text
    .split(/^---$/m)
    .filter((doc) => /^kind: \w+$/m.test(doc))
    .map((doc) => {
      const apiVersion = /^apiVersion: (\S+)$/m.exec(doc)![1]!;
      const namespace = /^metadata:\n(?: {2}.*\n)*? {2}namespace: (\S+)$/m.exec(
        doc,
      )?.[1];
      return {
        group: apiVersion.includes("/") ? apiVersion.split("/")[0]! : "",
        kind: /^kind: (\w+)$/m.exec(doc)![1]!,
        ...(namespace === undefined
          ? {}
          : { namespace: namespace.replaceAll('"', "") }),
      };
    });

/** Every resource the named component renders, as Argo CD applies it: a chart with its environment values, a manifest directory as it stands. */
export async function renderedResources(
  repository: Repository,
  name: string,
): Promise<Resource[]> {
  const root = await findRoot();
  const component = repository.catalog.components.find((c) => c.name === name)!;
  if (!component.chart) {
    const files = await yamlFiles(join(root, component.source!));
    const texts = await Promise.all(files.map((f) => readFile(f, "utf8")));
    return texts.flatMap(resourcesOf);
  }
  const dir = await mkdtemp(join(tmpdir(), "kore-delivery-values-"));
  const values: string[] = [];
  const texts = repository.chartDelivery?.releaseValues?.[name] ?? [];
  for (const [position, text] of texts.entries()) {
    const file = join(dir, `values-${position}.yaml`);
    await writeFile(file, text);
    values.push("--values", file);
  }
  const { stdout } = await run("helm", [
    "template",
    name,
    join(root, component.chart),
    "--namespace",
    component.namespace,
    ...values,
    "--set",
    `gateway.className=kore,gateway.hostname=${platform.domain},gateway.platformHostname=*.example.${platform.domain}`,
  ]);
  return resourcesOf(stdout);
}
