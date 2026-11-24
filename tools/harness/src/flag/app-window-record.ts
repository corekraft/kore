// Docs: docs/decisions/0174-the-platform-turns-an-app-flag-on-from-evidence-it-collected-itself.md
import type { Result } from "../outcome/index.js";
import { FlagError } from "./overlay.js";

/** The one directory the platform writes app flag windows to, relative to the repository root. */
export const APP_OUTCOMES_DIR = "infra/app-outcomes";

/**
 * The outcome results, the harness vocabulary (RESULTS in outcome). Typed as a
 * record over every Result, so adding or dropping one fails the build here.
 * The outcome barrel is not imported at run time: it depends on this domain.
 */
const RESULT_NAMES: Record<Result, true> = {
  confirmed: true,
  refuted: true,
  inconclusive: true,
};

const APP = /^[a-z][a-z0-9-]*$/;
const FLAG = /^[a-z][a-z0-9.-]*$/;
const ENVIRONMENT = /^[a-z][a-z0-9-]*$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface SeriesValue {
  name: string;
  value: string;
}

/**
 * One activation window's verdict for an app flag, as the platform wrote it.
 * The harness outcome fields (Result, Kind, Source, Flag, Environment,
 * Evidence, Recorded) sit beside the app, its signed digest and app record
 * commit, the window, the evidence set and the quoted series (ADR 0174).
 */
export interface AppWindow {
  result: Result;
  kind: "verification";
  source: "platform-window";
  app: string;
  flag: string;
  environment: string;
  digest: string;
  commit: string;
  window: { start: string; end: string };
  evidence: string;
  evidenceSet: string[];
  series: SeriesValue[];
  summary: string;
  recorded: string;
}

const isText = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "" && !/[\r\n]/.test(value);

const matches = (value: unknown, pattern: RegExp): boolean =>
  isText(value) && pattern.test(value);

function isWindow(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { start, end } = value as Record<string, unknown>;
  if (typeof start !== "string" || typeof end !== "string") {
    return false;
  }
  const [from, to] = [Date.parse(start), Date.parse(end)];
  return Number.isFinite(from) && Number.isFinite(to) && from < to;
}

const isSeries = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every(
    (entry: unknown) =>
      typeof entry === "object" &&
      entry !== null &&
      isText((entry as Record<string, unknown>)["name"]) &&
      isText((entry as Record<string, unknown>)["value"]),
  );

const isEvidenceSet = (value: unknown): boolean =>
  Array.isArray(value) && value.length > 0 && value.every(isText);

/** The first rule the value breaks, in words, or undefined when it is a window. */
function problemWith(value: Record<string, unknown>): string | undefined {
  const rules: [boolean, string][] = [
    [
      typeof value["result"] === "string" &&
        Object.hasOwn(RESULT_NAMES, value["result"]),
      `result must be one of ${Object.keys(RESULT_NAMES).join(", ")}`,
    ],
    [value["kind"] === "verification", 'kind must be "verification"'],
    [value["source"] === "platform-window", 'source must be "platform-window"'],
    [
      matches(value["app"], APP),
      "app must be a lowercase name of letters, digits and hyphens",
    ],
    [
      matches(value["flag"], FLAG),
      "flag must be a lowercase flag name of letters, digits, dots and hyphens",
    ],
    [
      matches(value["environment"], ENVIRONMENT),
      "environment must be a lowercase name of letters, digits and hyphens",
    ],
    [
      matches(value["digest"], DIGEST),
      "digest must be sha256:<64 hex>, the signed image digest",
    ],
    [
      matches(value["commit"], COMMIT),
      "commit must be the app record's 40-character git commit",
    ],
    [
      isWindow(value["window"]),
      "window must be a start and an end time (ISO 8601) with start before end",
    ],
    [isText(value["evidence"]), "evidence must name what the window measured"],
    [
      isEvidenceSet(value["evidenceSet"]),
      "evidenceSet must list the signals the window judged",
    ],
    [
      isSeries(value["series"]),
      "series must quote each series by name and value, at least one",
    ],
    [isText(value["summary"]), "summary must state the verdict"],
    [matches(value["recorded"], DATE), "recorded must be the YYYY-MM-DD date"],
  ];
  return rules.find(([ok]) => !ok)?.[1];
}

/** The value as an app flag window, or an error naming `where` and the rule it breaks. */
export function validateWindow(value: unknown, where: string): AppWindow {
  const problem =
    typeof value === "object" && value !== null
      ? problemWith(value as Record<string, unknown>)
      : "the record is not an object";
  if (problem !== undefined) {
    throw new FlagError(`${where}: ${problem}. Fix it, then rerun.`);
  }
  return value as AppWindow;
}

/** The window read from record text. A record that is not JSON, or breaks a rule, is refused, never read as no window. */
export function parseWindow(text: string, where: string): AppWindow {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new FlagError(
      `${where} is not JSON; the platform writes each window record, so restore it from git rather than editing it.`,
    );
  }
  return validateWindow(value, where);
}

/** The record's text: JSON with a trailing newline, keys in the order the platform writes them. */
export function renderWindow(window: AppWindow): string {
  return `${JSON.stringify(window, null, 2)}\n`;
}

/** A timestamp as a path segment: 20261123T100000000Z, so no colon or dot is left. */
const compact = (iso: string): string =>
  new Date(iso).toISOString().replace(/[-:.]/g, "");

/** The repository path of a window's record: one file per environment, flag and exact window. */
export function windowPath(window: AppWindow): string {
  return [
    APP_OUTCOMES_DIR,
    window.environment,
    window.flag,
    `${compact(window.window.start)}_${compact(window.window.end)}.json`,
  ].join("/");
}
