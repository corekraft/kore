import type { RolloutChart } from "../ledger/index.js";
import { RolloutError } from "./locks.js";

const PREFIX = "chart:";

/** One `chart:<release>` row of `kore platform status --json`: the installed chart, or why it could not be read. */
export interface ChartRow {
  release: string;
  chart?: { name: string; version: string };
  detail?: string;
}

/** The comparison of a recorded rollout with the installed charts. */
export interface Comparison {
  /** How many recorded charts had a row to compare with. */
  compared: number;
  differences: string[];
  /** Recorded charts with no row; not a difference, and not a match. */
  notCompared: string[];
}

type Obj = Record<string, unknown>;
const isObject = (value: unknown): value is Obj =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The chart rows of `kore platform status --environment <env> --json`; refuses text that is not that list. */
export function parseChartRows(text: string): ChartRow[] {
  let rows: unknown;
  try {
    rows = JSON.parse(text);
  } catch {
    rows = undefined;
  }
  if (!Array.isArray(rows)) {
    throw new RolloutError(
      "The status is not the JSON list `kore platform status --environment <env> --json` prints; pipe that command's output in, or pass it with --status <file>.",
    );
  }
  return rows.filter(isObject).flatMap((row): ChartRow[] => {
    const name = row["name"];
    if (typeof name !== "string" || !name.startsWith(PREFIX)) {
      return [];
    }
    const release = name.slice(PREFIX.length);
    const chart = row["chart"];
    if (
      isObject(chart) &&
      typeof chart["name"] === "string" &&
      typeof chart["version"] === "string"
    ) {
      return [
        { release, chart: { name: chart["name"], version: chart["version"] } },
      ];
    }
    const detail = row["detail"];
    return [{ release, ...(typeof detail === "string" ? { detail } : {}) }];
  });
}

/** What differs between the recorded charts and the installed ones, by release name, comparing the chart's name and version only. */
export function compareRollout(
  recorded: readonly RolloutChart[],
  rows: readonly ChartRow[],
): Comparison {
  const result: Comparison = { compared: 0, differences: [], notCompared: [] };
  for (const { name, version } of recorded) {
    const installed = rows.find((row) => row.release === name);
    if (installed === undefined) {
      result.notCompared.push(
        `${name}: no Helm release row in the status (a release Argo CD delivers has none)`,
      );
      continue;
    }
    result.compared += 1;
    if (installed.chart === undefined) {
      result.differences.push(
        `${name}: recorded version ${version}, but the installed chart could not be read: ${installed.detail ?? "no detail"}`,
      );
    } else if (installed.chart.name !== name) {
      result.differences.push(
        `${name}: recorded chart ${name}, installed ${installed.chart.name}`,
      );
    } else if (installed.chart.version !== version) {
      result.differences.push(
        `${name}: recorded version ${version}, installed ${installed.chart.version}`,
      );
    }
  }
  return result;
}
