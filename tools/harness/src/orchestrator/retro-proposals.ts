/** The most ideas one retro files; the rest are dropped and counted. */
export const RETRO_CAP = 5;

/** The lines that fence the retro pane's JSON, so the filing tool finds it among the pane's other output. */
export const PROPOSALS_BEGIN = "PROPOSALS-JSON";
export const PROPOSALS_END = "END-PROPOSALS-JSON";

const MAX_LENGTH = 500;
const WINDOW = /^[1-9]\d*d$/;
/** A frontmatter scalar must not start like YAML syntax; the idea domain refuses it too. */
const YAML_START = /^[[{|>&*!-]/;

/** One idea a retro proposes, with the fields `idea new` takes. */
export interface Proposal {
  title: string;
  hypothesis: string;
  expectedOutcome: string;
  measurement: string;
  safetyPattern: string;
  metric: string;
  direction: "up" | "down";
  window: string;
}

const FIELDS = [
  "title",
  "hypothesis",
  "expectedOutcome",
  "measurement",
  "safetyPattern",
  "metric",
  "direction",
  "window",
] as const;

const BEGIN_LINE = /^[ \t]*(?:[●⏺][ \t]+)?PROPOSALS-JSON[ \t\r]*$/;
const END_LINE = /^[ \t]*(?:[●⏺][ \t]+)?END-PROPOSALS-JSON[ \t\r]*$/;

/** The JSON between the last pair of markers in the pane's text, parsed but not yet trusted. */
export function readProposals(
  pane: string,
): { ok: true; batch: unknown } | { ok: false; error: string } {
  const lines = pane.split("\n");
  let found: string | undefined;
  let start: number | undefined;
  lines.forEach((line, at) => {
    if (BEGIN_LINE.test(line)) {
      start = at;
    } else if (END_LINE.test(line) && start !== undefined) {
      found = lines.slice(start + 1, at).join("\n");
      start = undefined;
    }
  });
  if (found === undefined) {
    return {
      ok: false,
      error: `The retro pane printed no proposals; it must end with its JSON array between a ${PROPOSALS_BEGIN} line and a ${PROPOSALS_END} line. Nothing was filed; rerun the retro.`,
    };
  }
  try {
    return { ok: true, batch: JSON.parse(found) as unknown };
  } catch {
    return {
      ok: false,
      error: `The retro pane's proposals are not valid JSON; they must be one JSON array between ${PROPOSALS_BEGIN} and ${PROPOSALS_END}. Nothing was filed.`,
    };
  }
}

function itemError(
  item: unknown,
  metrics: readonly string[],
  patterns: readonly string[],
): string | undefined {
  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    return "is not an object";
  }
  const raw = item as Record<string, unknown>;
  const stray = Object.keys(raw).find(
    (key) => !(FIELDS as readonly string[]).includes(key),
  );
  if (stray !== undefined) {
    return `has the unknown field ${stray}; use only ${FIELDS.join(", ")}`;
  }
  for (const field of FIELDS) {
    const value = raw[field];
    if (typeof value !== "string" || value.trim() === "") {
      return `has no ${field}; give it a non-empty string`;
    }
    if (value.length > MAX_LENGTH) {
      return `has a ${field} over ${MAX_LENGTH} characters; shorten it`;
    }
    if (YAML_START.test(value.trim())) {
      return `has a ${field} starting with "${value.trim().slice(0, 1)}"; reword it as plain text`;
    }
  }
  if (!metrics.includes(raw["metric"] as string)) {
    return `has a metric that is not a flow report metric; use one of ${metrics.join(", ")}`;
  }
  if (!patterns.includes(raw["safetyPattern"] as string)) {
    return `has a safetyPattern that is not recognised; use one of ${patterns.join(", ")}`;
  }
  if (raw["direction"] !== "up" && raw["direction"] !== "down") {
    return "has a direction that is not up or down";
  }
  if (!WINDOW.test(raw["window"] as string)) {
    return "has a window that is not a number of days such as 14d";
  }
  return undefined;
}

/**
 * Treats the pane's JSON as untrusted: the whole batch is checked, and one bad
 * item refuses it all with what to fix. `metrics` and `patterns` are what the
 * idea domain accepts.
 */
export function checkBatch(
  batch: unknown,
  metrics: readonly string[],
  patterns: readonly string[],
): { ok: true; proposals: Proposal[] } | { ok: false; error: string } {
  if (!Array.isArray(batch)) {
    return {
      ok: false,
      error:
        "The retro pane's proposals are not an array; it must print one JSON array, one object per idea. Nothing was filed.",
    };
  }
  for (const [at, item] of batch.entries()) {
    const problem = itemError(item, metrics, patterns);
    if (problem !== undefined) {
      return {
        ok: false,
        error: `Proposal ${at + 1} ${problem}. The whole batch is refused and nothing was filed; fix the retro pane's output and rerun.`,
      };
    }
  }
  return { ok: true, proposals: batch as Proposal[] };
}

/** The text an idea is keyed on: every field in a fixed order, so the same proposal is always the same text. */
export function contentOf(proposal: Proposal): string {
  return JSON.stringify(FIELDS.map((field) => proposal[field]));
}
