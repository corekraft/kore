export const SOURCES = ["claude", "herdr", "github"] as const;
export type Source = (typeof SOURCES)[number];

export const KINDS = [
  "session.start",
  "session.stop",
  "tool.start",
  "tool.end",
  "pane.spawned",
  "pane.busy",
  "pane.waiting",
  "pane.closed",
  "issue.opened",
  "issue.labelled",
  "issue.closed",
  "pr.opened",
  "pr.merged",
  "outcome",
  "flag.activated",
  "token.usage",
  "session.launch",
  "guard.audit",
  "challenge.round",
] as const;
export type Kind = (typeof KINDS)[number];

export const OUTCOMES = ["success", "failure"] as const;
export type Outcome = (typeof OUTCOMES)[number];

const TOOL_KINDS: readonly Kind[] = ["tool.start", "tool.end"];
const NUMBER_KINDS: readonly Kind[] = [
  "issue.opened",
  "issue.labelled",
  "issue.closed",
  "pr.opened",
  "pr.merged",
  "outcome",
  "challenge.round",
];

const LAUNCH_KINDS: readonly Kind[] = ["session.launch"];
const TOKEN_KINDS: readonly Kind[] = ["token.usage"];

export const SCHEMA_VERSION = 1;

/** The fields a caller supplies. `recordedAt` and `schema` are the ledger's. */
export interface EventInput {
  id?: string;
  source: Source;
  kind: Kind;
  occurredAt: string;
  session?: string;
  pane?: string;
  agent?: string;
  idea?: string;
  stage?: string;
  tool?: string;
  outcome?: Outcome;
  label?: string;
  number?: number;
  /** token.usage: the session's cumulative tokens so far. */
  tokens?: number;
  /** session.launch: the role the session was launched as. */
  role?: string;
  /** session.launch: the model tier the session was launched on. */
  tier?: string;
}

export interface LedgerEvent extends EventInput {
  schema: typeof SCHEMA_VERSION;
  id: string;
  recordedAt: string;
}

export type ParseResult =
  | { ok: true; event: EventInput | LedgerEvent }
  | { ok: false; field: string; message: string };

/** Which shape is being checked: caller input, or a line read back from disk. */
export type ParseMode = "input" | "stored";

const NAME = /^[\w.:/#@-]{1,128}$/;
const TOOL = /^[\w.:-]{1,100}$/;
const LABEL = /^[^\p{Cc}]{1,100}$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const NAME_HINT = "must be 1-128 letters, digits or . _ : / # @ -";
const TIME_HINT =
  "must be an ISO 8601 UTC time such as 2026-01-02T03:04:05.000Z";

type Raw = Record<string, unknown>;
type Failure = Extract<ParseResult, { ok: false }>;

/** Every field the ledger may hold. Anything else, such as prompt text, is refused. */
const ALLOWED = new Set<string>([
  "schema",
  "id",
  "source",
  "kind",
  "occurredAt",
  "recordedAt",
  "session",
  "pane",
  "agent",
  "idea",
  "stage",
  "tool",
  "outcome",
  "label",
  "number",
  "tokens",
  "role",
  "tier",
]);

/** Whether a value passes the ledger's name rule (session, pane, agent and similar fields). */
export function isName(value: unknown): value is string {
  return typeof value === "string" && NAME.test(value);
}

export function isTimestamp(value: string): boolean {
  if (!TIMESTAMP.test(value)) {
    return false;
  }
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) {
    return false;
  }
  // Rejects overflow such as 02-31, which Date would roll into March.
  return time.toISOString().slice(0, 10) === value.slice(0, 10);
}

function bad(field: string, problem: string): Failure {
  return {
    ok: false,
    field,
    message: `Invalid event: field "${field}" ${problem}.`,
  };
}

const isText = (pattern: RegExp) => (value: unknown) =>
  typeof value === "string" && pattern.test(value);

interface Rule {
  field: string;
  check(value: unknown): boolean;
  hint: string;
  /** Kinds on which the field is required and allowed; undefined means any kind, optional. */
  kinds?: readonly Kind[];
}

const RULES: readonly Rule[] = [
  { field: "id", check: isText(NAME), hint: NAME_HINT },
  { field: "session", check: isText(NAME), hint: NAME_HINT },
  { field: "pane", check: isText(NAME), hint: NAME_HINT },
  { field: "agent", check: isText(NAME), hint: NAME_HINT },
  { field: "idea", check: isText(NAME), hint: NAME_HINT },
  { field: "stage", check: isText(NAME), hint: NAME_HINT },
  {
    field: "tool",
    check: isText(TOOL),
    hint: "must be a tool name of letters, digits or . _ : -",
    kinds: TOOL_KINDS,
  },
  {
    field: "outcome",
    check: (v) => OUTCOMES.includes(v as Outcome),
    hint: `must be one of ${OUTCOMES.join(", ")}`,
    kinds: ["tool.end"],
  },
  {
    field: "label",
    check: isText(LABEL),
    hint: "must be 1-100 characters with no control characters",
    kinds: [
      "issue.labelled",
      "outcome",
      "flag.activated",
      "guard.audit",
      "challenge.round",
    ],
  },
  {
    field: "number",
    check: (v) => Number.isSafeInteger(v) && (v as number) >= 1,
    hint: "must be a positive integer",
    kinds: NUMBER_KINDS,
  },
  {
    field: "tokens",
    check: (v) => Number.isSafeInteger(v) && (v as number) >= 1,
    hint: "must be a positive integer",
    kinds: TOKEN_KINDS,
  },
  { field: "role", check: isText(NAME), hint: NAME_HINT, kinds: LAUNCH_KINDS },
  { field: "tier", check: isText(NAME), hint: NAME_HINT, kinds: LAUNCH_KINDS },
];

function checkShape(input: unknown, mode: ParseMode): Failure | undefined {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return bad("event", "must be a JSON object");
  }
  const raw = input as Raw;
  for (const key of Object.keys(raw)) {
    if (!ALLOWED.has(key) && raw[key] !== undefined) {
      return bad(key, "is not a ledger field and is never stored");
    }
  }
  if (mode === "input") {
    for (const field of ["recordedAt", "schema"]) {
      if (raw[field] !== undefined) {
        return bad(field, "is set by the ledger, not the caller");
      }
    }
  }
  return undefined;
}

function checkCore(raw: Raw, mode: ParseMode): Failure | undefined {
  if (mode === "stored" && raw["schema"] !== SCHEMA_VERSION) {
    return bad("schema", `must be ${SCHEMA_VERSION}`);
  }
  if (!SOURCES.includes(raw["source"] as Source)) {
    return bad("source", `must be one of ${SOURCES.join(", ")}`);
  }
  if (!KINDS.includes(raw["kind"] as Kind)) {
    return bad("kind", `must be one of ${KINDS.join(", ")}`);
  }
  const times =
    mode === "stored" ? ["occurredAt", "recordedAt"] : ["occurredAt"];
  for (const field of times) {
    const value = raw[field];
    if (typeof value !== "string" || !isTimestamp(value)) {
      return bad(field, TIME_HINT);
    }
  }
  return undefined;
}

function checkRule(rule: Rule, raw: Raw, mode: ParseMode): Failure | undefined {
  const value = raw[rule.field];
  const kind = raw["kind"] as Kind;
  const applies = rule.kinds === undefined || rule.kinds.includes(kind);
  if (value === undefined) {
    const needed =
      (rule.kinds !== undefined && applies) ||
      (rule.field === "id" && mode === "stored");
    return needed
      ? bad(rule.field, `is required on ${kind} events`)
      : undefined;
  }
  if (!applies) {
    return bad(
      rule.field,
      `is only allowed on ${rule.kinds?.join(" and ")} events`,
    );
  }
  return rule.check(value) ? undefined : bad(rule.field, rule.hint);
}

/**
 * Validates one event. Optional fields are omitted, never null; unknown fields
 * are rejected so prompt text, tool input and file contents cannot be stored.
 */
export function parseEvent(input: unknown, mode: ParseMode): ParseResult {
  const failure =
    checkShape(input, mode) ??
    checkCore(input as Raw, mode) ??
    RULES.map((rule) => checkRule(rule, input as Raw, mode)).find(Boolean);
  if (failure !== undefined) {
    return failure;
  }
  const event = Object.fromEntries(
    Object.entries(input as Raw).filter(([, value]) => value !== undefined),
  );
  return { ok: true, event: event as unknown as EventInput };
}
