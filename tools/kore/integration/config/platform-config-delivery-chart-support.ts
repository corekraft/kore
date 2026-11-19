import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { findRoot, loadRepository } from "../../src/config/index.js";
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

const topLevelKinds = (text: string) =>
  [...text.matchAll(/^kind: (\w+)$/gm)].map((m) => m[1]!);

export async function renderedKinds(name: string): Promise<string[]> {
  const root = await findRoot();
  const repository = await loadRepository("local");
  const component = repository.catalog.components.find((c) => c.name === name)!;
  if (component.chart) {
    const { stdout } = await run("helm", [
      "template",
      name,
      join(root, component.chart),
      "--set",
      `gateway.className=kore,gateway.hostname=${platform.domain}`,
    ]);
    return topLevelKinds(stdout);
  }
  const files = await yamlFiles(join(root, component.source!));
  const texts = await Promise.all(files.map((f) => readFile(f, "utf8")));
  return texts.flatMap(topLevelKinds);
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
