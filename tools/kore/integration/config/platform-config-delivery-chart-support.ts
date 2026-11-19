import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { findRoot, loadRepository } from "../../src/config/index.js";

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
      "gateway.className=kore",
    ]);
    return topLevelKinds(stdout);
  }
  const files = await yamlFiles(join(root, component.source!));
  const texts = await Promise.all(files.map((f) => readFile(f, "utf8")));
  return texts.flatMap(topLevelKinds);
}
