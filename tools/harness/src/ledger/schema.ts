import { HOST_RULES } from "./schema-host.js";
import {
  DECISION_ROUTE_RULES,
  KINDS,
  LABEL_KINDS,
  LINK_RULES,
  NUMBER_KINDS,
  SPLIT_RULES,
  type DecisionRouteOrigin,
  type Kind,
  type SplitOrigin,
} from "./schema-kinds.js";
import { BACKGROUND_RULES, RESULT_RULES } from "./schema-result.js";
import { SENDER_RULES, type HandoverReason } from "./schema-sender.js";
import { REVIEW_RULES } from "./schema-review.js";
import { SEND_BACK_RULES, type SendBackCategory } from "./schema-send-back.js";
import { EFFORT_RULES, TIER_RULES, type TierOrigin } from "./schema-tier.js";
import { MERGED_RULES, isTimestamp, type MergedOrigin } from "./schema-time.js";

export { isTimestamp };

export const SOURCES = ["claude", "herdr", "github"] as const;
export type Source = (typeof SOURCES)[number];

export { KINDS, type Kind };

export const OUTCOMES = ["success", "failure"] as const;
export type Outcome = (typeof OUTCOMES)[number];

const TOOL_KINDS: readonly Kind[] = ["tool.start", "tool.end"];

/** Workflow runs GitHub concluded: only the conclusion and its time are kept. */
const RUN_KINDS: readonly Kind[] = ["tool.end", "ci.main", "ci.nightly"];

/** Kinds only `ledger poll-github` writes, from GitHub's own records; `ledger record` refuses them. */
export const POLLER_KINDS: readonly Kind[] = [
  "issue.opened",
  "issue.labelled",
  "issue.closed",
  "pr.opened",
  "pr.merged",
  "ci.main",
  "ci.nightly",
  "main.revert",
  "owner.action",
  "owner.replied",
  "advisor.overturned",
];

const LAUNCH_KINDS: readonly Kind[] = ["session.launch"];
const TOKEN_KINDS: readonly Kind[] = ["token.usage"];

export const SCHEMA_VERSION = 1;

/**
 * The fields a caller supplies. `recordedAt` and `schema` are the ledger's. On
 * session.launch, `tierSource` and `tierReason` say where the tier came from,
 * and `effort` the level it ran at; a launch from before they existed has none
 * of them and reads as unknown.
 */
export interface EventInput
  extends
    Partial<TierOrigin>,
    Partial<MergedOrigin>,
    Partial<DecisionRouteOrigin>,
    Partial<SplitOrigin> {
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
  /** send-back: why the change went back; absent on a send-back from before categories existed. */
  category?: SendBackCategory;
  /** review.run: the findings the verdict gave, 0 for a clean review; absent on a review from before the verdict was recorded. */
  findings?: number;
  /** review.run: the rules the findings cite, as comma-separated short labels and never verdict text; absent when none were recorded. */
  rules?: string;
  /** session.launch: the role the session was launched as. */
  role?: string;
  /** session.launch: the model tier the session was launched on. */
  tier?: string;
  /** session.launch: the effort level the session ran at; absent on a launch from before it was recorded. */
  effort?: string;
  /** session.send: the sender's role and session name; absent for a send from the main session. */
  senderRole?: string;
  senderName?: string;
  /** session.send: why the main session passed the case to the stronger session; absent on an ordinary send. */
  handover?: HandoverReason;
  /** host-sample: the host's 1-minute load average; absent when the host reported none. */
  load?: number;
  /** host-sample: free memory as a share of total, 0 to 1; absent when unreadable. */
  memory?: number;
  /** host-sample: swap in use in bytes; absent when unreadable. */
  swap?: number;
  /** host-sample: delivery-loop sessions live at that moment. */
  sessions?: number;
  /** host-sample: whether the local platform was up. */
  platform?: boolean;
  /** session.result and pane.finished: the outcome word on a RESULT line, and nothing else. */
  result?: "done" | "blocked";
  /** tool.start: true when the command runs in the background; absent on every foreground call (#854). */
  background?: true;
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
  ...TIER_RULES.map((rule) => rule.field),
  ...EFFORT_RULES.map((rule) => rule.field),
  ...[...SEND_BACK_RULES, ...REVIEW_RULES].map((rule) => rule.field),
  ...SENDER_RULES.map((rule) => rule.field),
  ...MERGED_RULES.map((rule) => rule.field),
  ...RESULT_RULES.map((rule) => rule.field),
  ...BACKGROUND_RULES.map((rule) => rule.field),
  ...DECISION_ROUTE_RULES.map((rule) => rule.field),
  ...SPLIT_RULES.map((rule) => rule.field),
  "load",
  "memory",
  "swap",
  "sessions",
  "platform",
  "background",
]);

/** Whether a value passes the ledger's name rule (session, pane, agent and similar fields). */
export function isName(value: unknown): value is string {
  return typeof value === "string" && NAME.test(value);
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
  /** The field may be omitted on its kinds, but is checked when present. */
  optional?: boolean;
  /** Kinds on which the field is allowed and may be omitted, as a spawn with no reason omits its label. */
  omittableOn?: readonly Kind[];
  /** Kinds on which the field must be present; every other kind may omit it. */
  requiredOn?: readonly Kind[];
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
    kinds: RUN_KINDS,
  },
  {
    field: "label",
    check: isText(LABEL),
    hint: "must be 1-100 characters with no control characters",
    kinds: LABEL_KINDS,
    // A session.send from before a tick notice carried its state has no label, and still reads.
    omittableOn: ["spawn.unstamped", "session.send"],
  },
  {
    field: "number",
    check: (v) => Number.isSafeInteger(v) && (v as number) >= 1,
    hint: "must be a positive integer",
    kinds: NUMBER_KINDS,
    // A decision recorded before it carried its issue number has none, and still reads; so does a
    // route recorded without a posted question (#854), which carries no issue number.
    omittableOn: ["decision.made", "decision.routed"],
  },
  {
    field: "tokens",
    check: (v) => Number.isSafeInteger(v) && (v as number) >= 1,
    hint: "must be a positive integer",
    kinds: TOKEN_KINDS,
  },
  {
    field: "role",
    check: isText(NAME),
    hint: NAME_HINT,
    kinds: [...LAUNCH_KINDS, "spawn.unstamped"],
  },
  { field: "tier", check: isText(NAME), hint: NAME_HINT, kinds: LAUNCH_KINDS },
  ...LINK_RULES,
  ...TIER_RULES,
  ...EFFORT_RULES,
  ...BACKGROUND_RULES,
  ...SEND_BACK_RULES,
  ...REVIEW_RULES,
  ...SENDER_RULES,
  ...MERGED_RULES,
  ...RESULT_RULES,
  ...HOST_RULES,
  ...DECISION_ROUTE_RULES,
  ...SPLIT_RULES,
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
      (rule.kinds !== undefined &&
        applies &&
        rule.optional !== true &&
        !rule.omittableOn?.includes(kind)) ||
      rule.requiredOn?.includes(kind) === true ||
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
