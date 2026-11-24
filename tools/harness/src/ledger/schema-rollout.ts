import type { Kind } from "./schema-kinds.js";

const ROLLOUT_KINDS: readonly Kind[] = ["platform.rolled-out"];

/** Kinds only their owning harness command writes; `ledger record` refuses them, so no hand-typed event stands in for a rollout. */
export const COMMAND_OWNED_KINDS: readonly Kind[] = ["platform.rolled-out"];

const TAG = /^v\d+\.\d+\.\d+$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const CHART = /^[\w.+-]+@[\w.+-]+=sha256:[0-9a-f]{64}$/;

const isDigest = (v: unknown) => typeof v === "string" && DIGEST.test(v);

/** One recorded chart: its release name, the chart version, and the lock entry's digest. */
export interface RolloutChart {
  name: string;
  version: string;
  digest: string;
}

/** The recorded chart list, as `name@version=sha256:<digest>` joined by commas. */
export function formatCharts(charts: readonly RolloutChart[]): string {
  return charts
    .map((chart) => `${chart.name}@${chart.version}=${chart.digest}`)
    .join(",");
}

/** The charts of a recorded list; the schema has already checked its shape. */
export function parseCharts(text: string): RolloutChart[] {
  return text.split(",").map((entry) => {
    const [identity = "", digest = ""] = entry.split("=");
    const at = identity.indexOf("@");
    return {
      name: identity.slice(0, at),
      version: identity.slice(at + 1),
      digest,
    };
  });
}

/** The platform.rolled-out fields of an event: the environment and release tag, the sha256 of each lock file, and the charts as `formatCharts` writes them. */
export interface RolloutOrigin {
  environment: string;
  tag: string;
  chartLock: string;
  imageLock: string;
  charts: string;
}

/** The platform.rolled-out payload: the environment and release tag, the sha256 of each lock file, and each chart's name, version and entry digest. All are required. */
export const ROLLOUT_RULES = [
  {
    field: "environment",
    check: (v: unknown) => typeof v === "string" && /^[\w.-]{1,64}$/.test(v),
    hint: "must be an environment name of letters, digits or . _ -",
    kinds: ROLLOUT_KINDS,
  },
  {
    field: "tag",
    check: (v: unknown) => typeof v === "string" && TAG.test(v),
    hint: "must be a release tag such as v1.4.0",
    kinds: ROLLOUT_KINDS,
  },
  {
    field: "chartLock",
    check: isDigest,
    hint: "must be sha256:<64 hex digits>",
    kinds: ROLLOUT_KINDS,
  },
  {
    field: "imageLock",
    check: isDigest,
    hint: "must be sha256:<64 hex digits>",
    kinds: ROLLOUT_KINDS,
  },
  {
    field: "charts",
    check: (v: unknown) =>
      typeof v === "string" &&
      v.length <= 16_384 &&
      v.split(",").every((entry) => CHART.test(entry)),
    hint: "must be name@version=sha256:<digest> entries joined by commas",
    kinds: ROLLOUT_KINDS,
  },
] as const;
