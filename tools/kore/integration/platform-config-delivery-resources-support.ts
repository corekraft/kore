import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { findRoot, type Repository } from "../src/config/index.js";
import { localPlatform } from "./local-platform-support.js";

const platform = await localPlatform();

const run = promisify(execFile);

// The namespaced resources the argocd-owned components render, each as
// <group>/<kind> (the core group is empty). A resource in neither this list nor
// the AppProject's cluster whitelist fails the spec, so a new one is decided,
// and a same-named kind from another API group is not mistaken for one of these.
export const namespacedKinds = new Set([
  "apps/Deployment",
  "/ConfigMap",
  "/Service",
  "/ServiceAccount",
  "cert-manager.io/Certificate",
  "gateway.networking.k8s.io/Gateway",
  "gateway.networking.k8s.io/HTTPRoute",
  "security.istio.io/AuthorizationPolicy",
  "security.istio.io/PeerAuthentication",
  "config.gatekeeper.sh/Config",
  "agentgateway.dev/AgentgatewayParameters",
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

export type Resource = {
  group: string;
  kind: string;
  /** The `metadata.namespace` the manifest sets, when it sets one. */
  namespace?: string;
};

export const resourcesOf = (text: string): Resource[] =>
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
    // The PostgreSQL API's chart takes no gateway value (ADR 0137), so it gets none.
    ...(name === "kore-postgresql-api"
      ? []
      : [
          "--set",
          `gateway.className=kore,gateway.hostname=${platform.domain},gateway.platformHostname=*.example.${platform.domain}`,
        ]),
  ]);
  return resourcesOf(stdout);
}
