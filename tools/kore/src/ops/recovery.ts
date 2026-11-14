import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Component, Repository } from "../config/index.js";
import { exists } from "../config/files.js";

export type Protection = "data-export" | "rebuild" | "scheduled-backup";

export type Schedule =
  { kind: "on-demand"; trigger: string } | { kind: "cron"; expression: string };

/** How one kind of platform data is protected and what recovery must achieve. */
export interface Objective {
  name: string;
  components: string[];
  data: string;
  environment: "local" | "managed";
  /** A managed objective is `planned` until a live restore test proves it. */
  status?: "planned" | "active";
  protection: Protection;
  schedule: Schedule;
  /** Longest tolerated data loss; null when nothing is recovered (rebuild). */
  rpoMinutes: number | null;
  /** Longest tolerated time from decision to restore until service is back. */
  rtoMinutes: number;
  reason?: string;
  /** Repository path of the opt-in live spec that proves the restore. */
  restoreTest?: string;
}

export interface RecoveryContext {
  components: string[];
  stateful: string[];
  exists: (path: string) => boolean;
}

const RECOVERY = "infra/catalog/recovery.yaml";
// Declarations that create a volume or label a claim; policy rules that merely
// name PersistentVolumeClaim as a matched kind do not hold state.
const STATE_MARKER =
  /"?platform\.kore\.dev\/retention"?:|"?persistence"?:|"?persistentVolume"?:|"?persistentVolumeClaim"?:|"?volumeClaimTemplates"?:|kind: PersistentVolumeClaim/;

export async function loadRecovery(root: string): Promise<Objective[]> {
  const parsed = JSON.parse(await readFile(join(root, RECOVERY), "utf8")) as {
    objectives?: Objective[];
  };
  return parsed.objectives ?? [];
}

async function files(path: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch {
    return [path];
  }
  const nested = await Promise.all(
    entries.map((entry) => files(join(path, entry.name))),
  );
  return nested.flat();
}

async function declaresState(root: string, paths: string[]): Promise<boolean> {
  for (const path of paths) {
    for (const file of await files(join(root, path))) {
      if (!(await exists(file))) {
        continue;
      }
      if (STATE_MARKER.test(await readFile(file, "utf8"))) {
        return true;
      }
    }
  }
  return false;
}

function declaredPaths(component: Component, repository: Repository): string[] {
  const source =
    component.kind === "helm" || /^https?:/.test(component.source ?? "")
      ? []
      : [component.chart ?? component.source ?? ""];
  return [
    ...source,
    ...(component.values ?? []),
    ...(repository.environment.componentValues?.[component.name] ?? []),
  ].filter(Boolean);
}

/** Catalog components whose values or sources declare a volume or retention label. */
export async function statefulComponents(
  root: string,
  repository: Repository,
): Promise<string[]> {
  const found: string[] = [];
  for (const component of repository.catalog.components) {
    if (await declaresState(root, declaredPaths(component, repository))) {
      found.push(component.name);
    }
  }
  return found.sort();
}

function wholeMinutes(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function objectiveProblems(
  objective: Objective,
  context: RecoveryContext,
): string[] {
  const name = objective.name;
  const problems: string[] = [];
  for (const component of objective.components) {
    if (!context.components.includes(component)) {
      problems.push(`${name}: unknown component ${component}`);
    }
  }
  if (!wholeMinutes(objective.rtoMinutes)) {
    problems.push(`${name}: rtoMinutes must be a positive whole number`);
  }
  if (objective.protection === "rebuild") {
    if (objective.rpoMinutes !== null) {
      problems.push(
        `${name}: rebuild recovers no data, so rpoMinutes must be null`,
      );
    }
    if (!objective.reason) {
      problems.push(`${name}: rebuild needs a reason the data is disposable`);
    }
  } else if (!wholeMinutes(objective.rpoMinutes)) {
    problems.push(`${name}: rpoMinutes must be a positive whole number`);
  }
  if (
    objective.schedule.kind === "cron" &&
    objective.schedule.expression.trim().split(/\s+/).length !== 5
  ) {
    problems.push(
      `${name}: schedule expression "${objective.schedule.expression}" is not a five-field cron expression`,
    );
  }
  const proven =
    objective.protection !== "rebuild" &&
    (objective.environment === "local" || objective.status === "active");
  if (proven && !objective.restoreTest) {
    problems.push(
      objective.environment === "local"
        ? `${name}: ${objective.protection} needs a restoreTest`
        : `${name}: an active ${objective.protection} needs a restoreTest`,
    );
  }
  if (objective.restoreTest) {
    if (!objective.restoreTest.endsWith(".live.spec.ts")) {
      problems.push(`${name}: restoreTest must be a *.live.spec.ts`);
    } else if (!context.exists(objective.restoreTest)) {
      problems.push(
        `${name}: restoreTest ${objective.restoreTest} does not exist`,
      );
    }
  }
  return problems;
}

/** What is wrong with the declared objectives; empty means every state is covered and tested. */
export function recoveryProblems(
  objectives: Objective[],
  context: RecoveryContext,
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const objective of objectives) {
    if (seen.has(objective.name)) {
      problems.push(`${objective.name}: duplicate objective name`);
    }
    seen.add(objective.name);
    problems.push(...objectiveProblems(objective, context));
  }
  const covered = new Set(
    objectives
      .filter((objective) => objective.environment === "local")
      .flatMap((objective) => objective.components),
  );
  for (const component of context.stateful) {
    if (!covered.has(component)) {
      problems.push(
        `${component}: stateful component has no local recovery objective in ${RECOVERY}`,
      );
    }
  }
  return problems;
}

/** Loads the objectives and checks them against the catalog and files of a repository. */
export async function checkRecovery(repository: Repository): Promise<{
  problems: string[];
  objectives: number;
  stateful: string[];
}> {
  const objectives = await loadRecovery(repository.root);
  const stateful = await statefulComponents(repository.root, repository);
  const present = new Set<string>();
  for (const objective of objectives) {
    if (
      objective.restoreTest &&
      (await exists(join(repository.root, objective.restoreTest)))
    ) {
      present.add(objective.restoreTest);
    }
  }
  return {
    problems: recoveryProblems(objectives, {
      components: repository.catalog.components.map((c) => c.name),
      stateful,
      exists: (path) => present.has(path),
    }),
    objectives: objectives.length,
    stateful,
  };
}
