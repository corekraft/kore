/** A tool's version as pinned in one file, keyed by that file's tool name. */
export type ToolPins = Readonly<Record<string, string>>;

/** .mise.toml names a tool differently from the catalog key. */
const MISE_NAME_TO_CATALOG: Readonly<Record<string, string>> = {
  opentofu: "tofu",
};

/** Tools the catalog pins that mise does not manage, with the reason each may stay out of .mise.toml. */
const CATALOG_ONLY_TOOLS: Readonly<Record<string, string>> = {
  docker: "the host Docker CLI is a prerequisite that mise does not install",
};

/** Tools .mise.toml pins that the catalog does not mirror. None are allowed today. */
const MISE_ONLY_TOOLS: Readonly<Record<string, string>> = {};

const has = (table: Readonly<Record<string, string>>, name: string): boolean =>
  Object.hasOwn(table, name);

/** Reads the name = "version" pins of the [tools] table of a .mise.toml, and nothing else. */
export function parseMiseTools(text: string): ToolPins {
  const tools: Record<string, string> = {};
  let inTools = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    const table = line.match(/^\[([^\]]+)\]$/);
    if (table) {
      inTools = table[1] === "tools";
      continue;
    }
    if (!inTools) {
      continue;
    }
    const pin = line.match(/^([A-Za-z0-9_-]+)\s*=\s*"([^"]*)"\s*$/);
    if (!pin) {
      throw new Error(
        `.mise.toml line '${line}' is not a tool pin; write it as name = "version"`,
      );
    }
    tools[pin[1]!] = pin[2]!;
  }
  return tools;
}

/**
 * Compares the tool pins of .mise.toml with the tool catalog. Returns one
 * problem per disagreement, naming the tool; an empty list means they agree.
 */
export function comparePinnedTools(
  mise: ToolPins,
  catalog: ToolPins,
): string[] {
  const miseByCatalogName = new Map<string, string>();
  for (const [name, version] of Object.entries(mise)) {
    const catalogName = has(MISE_NAME_TO_CATALOG, name)
      ? MISE_NAME_TO_CATALOG[name]!
      : name;
    miseByCatalogName.set(catalogName, version);
  }
  const names = new Set([...miseByCatalogName.keys(), ...Object.keys(catalog)]);
  const problems: string[] = [];
  for (const name of names) {
    const inMise = miseByCatalogName.get(name);
    const inCatalog = has(catalog, name) ? catalog[name] : undefined;
    if (inMise !== undefined && inCatalog !== undefined) {
      if (inMise !== inCatalog) {
        problems.push(
          `${name}: .mise.toml pins ${inMise}, infra/catalog/versions.yaml pins ${inCatalog}`,
        );
      }
      if (has(CATALOG_ONLY_TOOLS, name)) {
        problems.push(
          `${name} is in both files but listed as catalog-only; remove it from the allow list`,
        );
      }
      if (has(MISE_ONLY_TOOLS, name)) {
        problems.push(
          `${name} is in both files but listed as mise-only; remove it from the allow list`,
        );
      }
    } else if (inMise !== undefined) {
      if (!has(MISE_ONLY_TOOLS, name)) {
        problems.push(
          `${name} is pinned in .mise.toml but not in infra/catalog/versions.yaml; add it to the catalog or allow it`,
        );
      }
    } else if (inCatalog !== undefined) {
      if (!has(CATALOG_ONLY_TOOLS, name)) {
        problems.push(
          `${name} is pinned in infra/catalog/versions.yaml but not in .mise.toml; add it to .mise.toml or allow it`,
        );
      }
    }
  }
  return problems;
}
