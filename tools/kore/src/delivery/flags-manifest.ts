// Docs: docs/decisions/0169-an-app-declares-its-flags-and-the-platform-holds-their-state.md
// The schema of an application's flags.yaml. The file is JSON-compatible YAML (AGENTS.md),
// so it parses with JSON.parse and needs no YAML dependency.

export const SAFETY_PATTERNS = [
  "no-behaviour-change",
  "feature-flagged",
  "dark-launched",
  "expand-contract",
] as const;
export type SafetyPattern = (typeof SAFETY_PATTERNS)[number];

export const ROLLOUT_KINDS = ["flag", "canary", "dark-launch"] as const;
export type RolloutKind = (typeof ROLLOUT_KINDS)[number];

export interface Rollout {
  kind: RolloutKind;
  criteria: string[];
  soakHours: number;
}

export interface FlagDeclaration {
  name: string;
  default: false;
  owner: string;
  safetyPattern: SafetyPattern;
  expiry: string;
  rollout: Rollout;
}

export interface FlagsManifest {
  service: string;
  flags: FlagDeclaration[];
}

export interface ParsedManifest {
  manifest?: FlagsManifest;
  failures: string[];
}

const TOP_KEYS = ["service", "flags"];
const FLAG_KEYS = [
  "name",
  "default",
  "owner",
  "safetyPattern",
  "expiry",
  "rollout",
];
const ROLLOUT_KEYS = ["kind", "criteria", "soakHours"];
const SERVICE = /^[a-z][a-z0-9-]*$/;
const SEGMENT = /^[a-z][a-z0-9-]*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Parses and validates flags.yaml; every failure is reported, and a manifest is returned only when there are none. */
export function parseFlagsManifest(text: string): ParsedManifest {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
    return {
      failures: [
        `flags.yaml is not JSON-compatible YAML (${error.message}); write it in JSON syntax, which YAML accepts`,
      ],
    };
  }
  return validateManifest(value);
}

function validateManifest(value: unknown): ParsedManifest {
  if (!isObject(value)) {
    return {
      failures: ['flags.yaml must be an object with "service" and "flags"'],
    };
  }
  const failures = unknownKeyFailures(value, TOP_KEYS, "flags.yaml");
  const serviceText = typeof value.service === "string" ? value.service : "";
  const service = SERVICE.test(serviceText) ? serviceText : undefined;
  if (service === undefined) {
    failures.push(
      "service must be a lowercase name of letters, digits and hyphens, such as leads",
    );
  }
  if (!Array.isArray(value.flags)) {
    failures.push(
      "flags must be a list; use an empty list when the app has no flags",
    );
    return { failures };
  }
  const flags: FlagDeclaration[] = [];
  const names = new Set<string>();
  value.flags.forEach((entry: unknown, index: number) => {
    const result = validateFlag(entry, index, serviceText);
    failures.push(...result.failures);
    const flag = result.flag;
    if (flag === undefined) {
      return;
    }
    if (names.has(flag.name)) {
      failures.push(`flag ${flag.name} is declared more than once`);
    }
    names.add(flag.name);
    flags.push(flag);
  });
  if (failures.length > 0 || service === undefined) {
    return { failures };
  }
  return { manifest: { service, flags }, failures: [] };
}

interface FlagResult {
  flag?: FlagDeclaration;
  failures: string[];
}

function validateFlag(
  entry: unknown,
  index: number,
  service: string,
): FlagResult {
  if (!isObject(entry)) {
    return { failures: [`flags[${index}] must be an object`] };
  }
  const label = typeof entry.name === "string" ? entry.name : `flags[${index}]`;
  const { name, owner, safetyPattern, expiry } = entry;
  const rollout = parseRollout(entry.rollout, label);
  const failures = [
    ...unknownKeyFailures(entry, FLAG_KEYS, `flag ${label}`),
    ...nameFailures(name, label, service),
    ...(entry.default === false
      ? []
      : [`flag ${label}: default must be false; every flag ships off`]),
    ...(isText(owner)
      ? []
      : [`flag ${label}: owner must name who owns the flag`]),
    ...(isSafetyPattern(safetyPattern)
      ? []
      : [
          `flag ${label}: safetyPattern must be one of ${SAFETY_PATTERNS.join(", ")}`,
        ]),
    ...(isDate(expiry)
      ? []
      : [`flag ${label}: expiry must be a date as YYYY-MM-DD`]),
    ...rollout.failures,
  ];
  if (
    failures.length > 0 ||
    !isText(name) ||
    !isText(owner) ||
    !isSafetyPattern(safetyPattern) ||
    !isDate(expiry) ||
    rollout.rollout === undefined
  ) {
    return { failures };
  }
  return {
    failures,
    flag: {
      name,
      default: false,
      owner,
      safetyPattern,
      expiry,
      rollout: rollout.rollout,
    },
  };
}

function nameFailures(name: unknown, label: string, service: string): string[] {
  if (typeof name !== "string") {
    return [`${label}: name must be a string`];
  }
  const prefix = `${service}.`;
  if (!name.startsWith(prefix)) {
    return [
      `flag ${name}: name must start with the service prefix "${prefix}"`,
    ];
  }
  if (!SEGMENT.test(name.slice(prefix.length))) {
    return [
      `flag ${name}: the part after "${prefix}" must be lowercase letters, digits and hyphens`,
    ];
  }
  return [];
}

interface RolloutResult {
  rollout?: Rollout;
  failures: string[];
}

function parseRollout(value: unknown, label: string): RolloutResult {
  if (value === undefined) {
    return {
      failures: [
        `flag ${label} has no rollout; a flag needs a kind, criteria and a soak window`,
      ],
    };
  }
  if (!isObject(value)) {
    return {
      failures: [
        `flag ${label}: rollout must be an object with kind, criteria and soakHours`,
      ],
    };
  }
  const { kind, criteria, soakHours } = value;
  const failures = [
    ...unknownKeyFailures(value, ROLLOUT_KEYS, `flag ${label} rollout`),
    ...(isKind(kind)
      ? []
      : [`flag ${label}: rollout.kind must be flag, canary or dark-launch`]),
    ...(isCriteria(criteria)
      ? []
      : [
          `flag ${label}: rollout.criteria must name at least one criterion, as a list of strings`,
        ]),
    ...(isSoakHours(soakHours)
      ? []
      : [
          `flag ${label}: rollout.soakHours must be a whole number of hours, at least 1`,
        ]),
  ];
  if (
    !isKind(kind) ||
    !isCriteria(criteria) ||
    !isSoakHours(soakHours) ||
    failures.length > 0
  ) {
    return { failures };
  }
  return { failures, rollout: { kind, criteria, soakHours } };
}

function unknownKeyFailures(
  value: Record<string, unknown>,
  allowed: readonly string[],
  prefix: string,
): string[] {
  return Object.keys(value)
    .filter((key) => !allowed.includes(key))
    .map(
      (key) =>
        `${prefix}: unknown key "${key}"; allowed keys are ${allowed.join(", ")}`,
    );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

export function isSafetyPattern(value: unknown): value is SafetyPattern {
  return SAFETY_PATTERNS.some((pattern) => pattern === value);
}

function isKind(value: unknown): value is RolloutKind {
  return ROLLOUT_KINDS.some((kind) => kind === value);
}

function isCriteria(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((criterion) => isText(criterion))
  );
}

function isSoakHours(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

/** A real calendar date as YYYY-MM-DD: 2026-02-31 and 2026-6-1 are refused. */
export function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === (month ?? 1) - 1 &&
    date.getUTCDate() === day
  );
}
