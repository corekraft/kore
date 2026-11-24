import {
  enabledComponents,
  releaseOwner,
  type Component,
  type Repository,
} from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { errorMessage } from "./probe.js";

// Docs: docs/decisions/0150-platform-releases-reach-vps-by-a-recorded-rollout-and-roll-back-by-revert.md

/** Every chart row's name starts with this, so a caller can tell the audit rows from component rows. */
export const chartVersionRowPrefix = "chart:";

export interface ChartVersionStatus {
  name: string;
  namespace: string;
  status: "ready" | "missing";
  detail: string;
  /** Present when helm named the release's installed chart. */
  chart?: { name: string; version: string };
}

/** The chart name and version in `helm get metadata --output json`, or undefined when it names neither. */
function installedChart(
  stdout: string,
): { name: string; version: string } | undefined {
  const parsed = JSON.parse(stdout) as { chart?: unknown; version?: unknown };
  return typeof parsed.chart === "string" &&
    parsed.chart !== "" &&
    typeof parsed.version === "string" &&
    parsed.version !== ""
    ? { name: parsed.chart, version: parsed.version }
    : undefined;
}

async function chartRow(
  repository: Repository,
  runner: Runner,
  component: Component,
): Promise<ChartVersionStatus> {
  const identity = {
    name: `${chartVersionRowPrefix}${component.name}`,
    namespace: component.namespace,
  };
  try {
    const metadata = await runner.run(
      "helm",
      [
        "get",
        "metadata",
        component.name,
        "--namespace",
        component.namespace,
        "--kube-context",
        repository.environment.kubeContext,
        "--output",
        "json",
      ],
      { capture: true },
    );
    const chart = installedChart(metadata.stdout);
    return chart
      ? {
          ...identity,
          status: "ready",
          detail: `${chart.name} ${chart.version}`,
          chart,
        }
      : {
          ...identity,
          status: "missing",
          detail: "helm named no chart or version for this release",
        };
  } catch (error) {
    return {
      ...identity,
      status: "missing",
      detail: `chart version could not be read: ${errorMessage(error)}`,
    };
  }
}

/**
 * One row per Helm release kore installs: the chart name and version the
 * cluster holds, read with `helm get metadata`. Read-only and audit-only: the
 * drift check compares these with the last recorded rollout (ADR 0150), and no
 * row gates `platform up` or the status exit code. A gated-off component, a
 * manifest component and an Argo CD owned release have no Helm release here,
 * so they get no row.
 */
export async function chartVersionStatus(
  repository: Repository,
  runner: Runner,
): Promise<ChartVersionStatus[]> {
  const rows: ChartVersionStatus[] = [];
  for (const component of enabledComponents(repository)) {
    if (
      component.kind === "manifest" ||
      releaseOwner(repository.environment, component) === "argocd"
    ) {
      continue;
    }
    rows.push(await chartRow(repository, runner, component));
  }
  return rows;
}
