import type { Inventory, InventoryItem, InventoryKind } from "./inventory.js";

const EXACT = /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const SHA512 = /^sha512-[A-Za-z0-9+/]+={0,2}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;

function exact(version: string): boolean {
  return EXACT.test(version);
}

function where(item: InventoryItem): string {
  return `${item.kind} ${item.name} (${item.source})`;
}

function versionProblems(item: InventoryItem): string[] {
  return exact(item.version)
    ? []
    : [
        `${where(item)}: version "${item.version}" is not an exact version; pin it`,
      ];
}

function imageProblems(item: InventoryItem): string[] {
  // An image with no registry host is a local build, which never has a digest.
  if (item.digest || !/[.:]/.test(item.version.split("/")[0] ?? "")) {
    return [];
  }
  return [
    `${where(item)}: ${item.version} has no sha256 digest; pin it by digest`,
  ];
}

function npmProblems(item: InventoryItem): string[] {
  return [
    ...(SHA512.test(item.integrity ?? "")
      ? []
      : [`${where(item)}: no sha512 integrity hash in the lockfile`]),
    ...(item.resolved?.startsWith("https://") === false
      ? [`${where(item)}: resolved from ${item.resolved}, which is not https`]
      : []),
  ];
}

function actionProblems(item: InventoryItem): string[] {
  return COMMIT.test(item.version)
    ? []
    : [`${where(item)}: pinned to "${item.version}", not a full commit SHA`];
}

function lockProblems(item: InventoryItem, inventory: Inventory): string[] {
  const entry = `lock entry ${item.name} (${item.source})`;
  return [
    ...(SHA256.test(item.digest ?? "")
      ? []
      : [`${entry}: digest "${item.digest}" is not a sha256 digest`]),
    ...(inventory.authorizedSigners.includes(item.resolved ?? "")
      ? []
      : [`${entry}: signer "${item.resolved}" is not an authorized signer`]),
  ];
}

const CHECKS: Record<
  InventoryKind,
  (item: InventoryItem, inventory: Inventory) => string[]
> = {
  tool: versionProblems,
  component: versionProblems,
  image: imageProblems,
  lock: lockProblems,
  npm: npmProblems,
  action: actionProblems,
};

/** Reviewable pin violations; empty means every dependency is exact and verifiable. */
export function integrityProblems(inventory: Inventory): string[] {
  const problems = inventory.items.flatMap((item) =>
    CHECKS[item.kind](item, inventory),
  );
  const tools = new Map(
    inventory.items
      .filter((item) => item.kind === "tool")
      .map((item) => [item.name, item.version]),
  );
  for (const [name, pinned] of Object.entries(inventory.misePins)) {
    const catalog = tools.get(name);
    if (catalog !== undefined && catalog !== pinned) {
      problems.push(
        `tool ${name}: .mise.toml pins ${pinned} but infra/catalog/versions.yaml pins ${catalog}`,
      );
    }
  }
  for (const [name, range] of Object.entries(inventory.npmRanges)) {
    if (!exact(range)) {
      problems.push(
        `npm ${name} (tools/kore/package.json): "${range}" is not an exact version; pin it`,
      );
    }
  }
  return problems;
}
