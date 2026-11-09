import type { Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { crdRollbackProblems, crdUpgradeProblems } from "./crd-compat.js";
import { chartCrds, helmChartComponents } from "./crd-render.js";
import { buildInventory } from "./inventory.js";
import { integrityProblems } from "./inventory-problems.js";
import { checkRecovery } from "./recovery.js";
import { previousRelease, snapshotAt, upgradeCheck } from "./upgrade.js";

export const OPS_ACTIONS = [
  "inventory",
  "recovery",
  "upgrade-check",
  "crd-check",
] as const;

export interface OpsOptions {
  repository: Repository;
  runner: Runner;
  json: boolean;
  /** Release tag to compare against; defaults to the newest `v*` tag. */
  from?: string;
}

export interface OpsReport {
  report: Record<string, unknown>;
  /** False when the report lists problems; the command then exits 1. */
  ok: boolean;
}

function verdict(
  problems: string[],
  fields: Record<string, unknown>,
): OpsReport {
  return {
    ok: problems.length === 0,
    report: {
      status: problems.length === 0 ? "valid" : "invalid",
      ...fields,
      problems,
    },
  };
}

async function inventory(options: OpsOptions): Promise<OpsReport> {
  const built = await buildInventory(options.repository.root);
  const counts: Record<string, number> = {};
  for (const item of built.items) {
    counts[item.kind] = (counts[item.kind] ?? 0) + 1;
  }
  return verdict(integrityProblems(built), {
    counts,
    ...(options.json ? { items: built.items } : {}),
  });
}

async function recovery(options: OpsOptions): Promise<OpsReport> {
  const { problems, objectives, stateful } = await checkRecovery(
    options.repository,
  );
  return verdict(problems, { objectives, stateful });
}

async function upgrade(options: OpsOptions): Promise<OpsReport> {
  const { root } = options.repository;
  const from = options.from ?? (await previousRelease(options.runner, root));
  const result = await upgradeCheck(options.runner, root, from);
  return verdict(result.problems, { from, changes: result.changes });
}

async function crdCheck(options: OpsOptions): Promise<OpsReport> {
  const { repository, runner } = options;
  const { root } = repository;
  const from = options.from ?? (await previousRelease(runner, root));
  const before = await snapshotAt(runner, root, from);
  const checked: string[] = [];
  const problems: string[] = [];
  for (const component of helmChartComponents(repository.catalog.components)) {
    const old = before.components[component.name];
    const now = repository.versions.components[component.version];
    if (!old || !now || old === now) {
      continue;
    }
    checked.push(component.name);
    const oldCrds = await chartCrds(runner, root, component, old);
    const newCrds = await chartCrds(runner, root, component, now);
    problems.push(
      ...[
        ...crdUpgradeProblems(oldCrds, newCrds),
        ...crdRollbackProblems(oldCrds, newCrds),
      ].map((problem) => `${component.name} ${old} -> ${now}: ${problem}`),
    );
  }
  return verdict(problems, { from, checked });
}

/** Read-only operational checks: pins, recovery objectives, upgrade and CRD safety. */
export async function opsReport(
  action: string,
  options: OpsOptions,
): Promise<OpsReport> {
  switch (action) {
    case "inventory":
      return await inventory(options);
    case "recovery":
      return await recovery(options);
    case "upgrade-check":
      return await upgrade(options);
    case "crd-check":
      return await crdCheck(options);
    default:
      throw new Error(
        `unknown ops action ${action}; use inventory, recovery, upgrade-check, or crd-check`,
      );
  }
}
