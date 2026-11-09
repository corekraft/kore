import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export type InventoryKind =
  "tool" | "component" | "image" | "lock" | "npm" | "action";

export interface InventoryItem {
  kind: InventoryKind;
  name: string;
  /** The pinned version, tag, or commit as declared. */
  version: string;
  /** Where the pin is declared, relative to the repository root. */
  source: string;
  digest?: string;
  integrity?: string;
  resolved?: string;
}

export interface Inventory {
  items: InventoryItem[];
  /** Pins a later check compares against each other (mise vs catalog). */
  misePins: Record<string, string>;
  /** package.json dependency ranges, by name. */
  npmRanges: Record<string, string>;
  authorizedSigners: string[];
}

const DIGEST = /@(sha256:[0-9a-f]{64})$/;
// mise names OpenTofu `opentofu`; the version catalog calls it `tofu`.
const MISE_ALIAS: Record<string, string> = { opentofu: "tofu" };

async function json(root: string, path: string): Promise<unknown> {
  return JSON.parse(await readFile(join(root, path), "utf8")) as unknown;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function image(
  name: string,
  reference: string,
  source: string,
  kind: InventoryKind = "image",
): InventoryItem {
  const digest = DIGEST.exec(reference)?.[1];
  const item: InventoryItem = {
    kind,
    name,
    version: reference.replace(DIGEST, ""),
    source,
  };
  if (digest) {
    item.digest = digest;
  }
  return item;
}

async function catalogItems(root: string): Promise<InventoryItem[]> {
  const items: InventoryItem[] = [];
  const versionsPath = "infra/catalog/versions.yaml";
  const versions = record(await json(root, versionsPath));
  const tools = record(versions.tools);
  for (const [name, version] of Object.entries(tools)) {
    items.push({
      kind: "tool",
      name,
      version: text(version),
      source: versionsPath,
    });
  }
  items.push({
    kind: "tool",
    name: "kubernetes",
    version: text(versions.kubernetes),
    source: versionsPath,
  });
  const components = record(versions.components);
  const catalog = record(await json(root, "infra/catalog/components.yaml"));
  for (const entry of Array.isArray(catalog.components)
    ? catalog.components
    : []) {
    const component = record(entry);
    const key = text(component.version);
    if (key === "local") {
      continue;
    }
    items.push({
      kind: "component",
      name: text(component.name),
      version: text(components[key]),
      source: "infra/catalog/components.yaml",
    });
  }
  for (const [name, reference] of Object.entries(record(versions.images))) {
    items.push(image(name, text(reference), versionsPath));
  }
  return items;
}

async function manifestImages(
  root: string,
  path: string,
  field: "images" | "seeds",
): Promise<InventoryItem[]> {
  const manifest = record(await json(root, path));
  const entries = Array.isArray(manifest[field]) ? manifest[field] : [];
  return entries.map((entry) => {
    const record_ = record(entry);
    return image(
      text(record_.name) || text(record_.catalogImage) || text(record_.image),
      text(record_.image),
      path,
    );
  });
}

async function lockItems(
  root: string,
): Promise<{ items: InventoryItem[]; signers: string[] }> {
  const path = "infra/catalog/images.lock.json";
  const lock = record(await json(root, path));
  const signers = Array.isArray(lock.authorizedSigners)
    ? lock.authorizedSigners.map(text)
    : [];
  const items = Object.entries(record(lock.entries)).map(([name, raw]) => {
    const entry = record(raw);
    return {
      kind: "lock" as const,
      name,
      version: text(entry.image),
      source: path,
      digest: text(entry.digest),
      resolved: text(entry.signer),
    };
  });
  return { items, signers };
}

async function npmItems(
  root: string,
): Promise<{ items: InventoryItem[]; ranges: Record<string, string> }> {
  const manifest = record(await json(root, "tools/kore/package.json"));
  const ranges: Record<string, string> = {};
  for (const section of ["dependencies", "devDependencies"]) {
    for (const [name, range] of Object.entries(record(manifest[section]))) {
      ranges[name] = text(range);
    }
  }
  const lock = record(await json(root, "tools/kore/package-lock.json"));
  const items: InventoryItem[] = [];
  for (const [path, raw] of Object.entries(record(lock.packages))) {
    if (path === "") {
      continue;
    }
    const entry = record(raw);
    const item: InventoryItem = {
      kind: "npm",
      name: path.slice(
        path.lastIndexOf("node_modules/") + "node_modules/".length,
      ),
      version: text(entry.version),
      source: "tools/kore/package-lock.json",
      resolved: text(entry.resolved),
    };
    if (typeof entry.integrity === "string") {
      item.integrity = entry.integrity;
    }
    items.push(item);
  }
  return { items, ranges };
}

async function actionItems(root: string): Promise<InventoryItem[]> {
  const directory = ".github/workflows";
  let files: string[] = [];
  try {
    files = (await readdir(join(root, directory))).filter((file) =>
      /\.ya?ml$/.test(file),
    );
  } catch {
    return [];
  }
  const items: InventoryItem[] = [];
  for (const file of files.sort()) {
    const body = await readFile(join(root, directory, file), "utf8");
    for (const match of body.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)) {
      const reference = match[1]!;
      if (reference.startsWith("./")) {
        continue;
      }
      const at = reference.lastIndexOf("@");
      items.push({
        kind: "action",
        name: at < 0 ? reference : reference.slice(0, at),
        version: at < 0 ? "" : reference.slice(at + 1),
        source: `${directory}/${file}`,
      });
    }
  }
  return items;
}

function misePins(body: string): Record<string, string> {
  const pins: Record<string, string> = {};
  let inTools = false;
  for (const line of body.split("\n")) {
    const section = /^\[(.+)\]\s*$/.exec(line);
    if (section) {
      inTools = section[1] === "tools";
      continue;
    }
    const pin = /^([\w-]+)\s*=\s*"([^"]*)"/.exec(line);
    if (inTools && pin) {
      pins[MISE_ALIAS[pin[1]!] ?? pin[1]!] = pin[2]!;
    }
  }
  return pins;
}

/** Everything the repository pins, read from files only, in a stable order. */
export async function buildInventory(root: string): Promise<Inventory> {
  const lock = await lockItems(root);
  const npm = await npmItems(root);
  const items = [
    ...(await catalogItems(root)),
    ...(await manifestImages(
      root,
      "infra/catalog/approved-images.yaml",
      "images",
    )),
    ...(await manifestImages(root, "infra/catalog/seeds.yaml", "seeds")),
    ...lock.items,
    ...npm.items,
    ...(await actionItems(root)),
  ].sort((a, b) =>
    `${a.kind}\0${a.name}\0${a.source}`.localeCompare(
      `${b.kind}\0${b.name}\0${b.source}`,
    ),
  );
  return {
    items,
    misePins: misePins(await readFile(join(root, ".mise.toml"), "utf8")),
    npmRanges: npm.ranges,
    authorizedSigners: lock.signers,
  };
}
