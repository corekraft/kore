import {
  TEXT_MAX,
  checkPaths,
  fieldRefusal,
  isRecord,
  refuse,
  strayField,
  textProblem,
  type PlanCheck,
  type ReadRequest,
  type Refusal,
} from "./judgment-check.js";
import { checkWork } from "./judgment-work.js";

export { BRIEF_MAX, TEXT_MAX } from "./judgment-check.js";
export type {
  Plan,
  ReadRequest,
  WorkPiece,
  WorkRole,
} from "./judgment-check.js";

/** The lines that fence a judgment pane's plan, so the tick finds it among the pane's other output (ADR 0121). */
export const PLAN_BEGIN = "PLAN-JSON";
export const PLAN_END = "END-PLAN-JSON";

const TOP_KEYS = ["reads", "work", "stop"];
const READ_FIELDS = ["question", "paths"];
const BEGIN_LINE = /^[ \t]*(?:[●⏺][ \t]+)?PLAN-JSON[ \t\r]*$/;
const END_LINE = /^[ \t]*(?:[●⏺][ \t]+)?END-PLAN-JSON[ \t\r]*$/;

export type PlanRead =
  { ok: true; raw: unknown } | { ok: false; error: string };

/** The JSON between the last pair of plan markers in the pane's text, parsed but not yet trusted. */
export function readPlan(pane: string): PlanRead {
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
      error: `The judgment pane printed no plan; it must end with one JSON object between the ${PLAN_BEGIN} line and the ${PLAN_END} line. Nothing was started; rerun the judgment pane.`,
    };
  }
  try {
    return { ok: true, raw: JSON.parse(found) as unknown };
  } catch {
    return {
      ok: false,
      error: `The judgment pane's plan is not valid JSON; it must be one JSON object between ${PLAN_BEGIN} and ${PLAN_END}. Nothing was started.`,
    };
  }
}

/**
 * Treats the plan as untrusted model text: the whole plan is checked, and one bad
 * item refuses it all, naming the item and the field to fix. Nothing is started by a refusal.
 */
export function checkPlan(raw: unknown): PlanCheck {
  if (!isRecord(raw)) {
    return refuse(
      "The plan is not one JSON object; it must be one object with exactly one of reads, work or stop.",
    );
  }
  const stray = strayField(raw, TOP_KEYS);
  if (stray !== undefined) {
    return refuse(
      `The plan has the unknown field ${stray}; use only reads, work or stop.`,
    );
  }
  const present = TOP_KEYS.filter((key) => Object.hasOwn(raw, key));
  if (present.length !== 1) {
    const found =
      present.length === 0
        ? "none"
        : `${present.length} (${present.join(", ")})`;
    return refuse(
      `The plan must have exactly one of reads, work or stop; it has ${found}.`,
    );
  }
  if (present[0] === "reads") {
    return checkReads(raw["reads"]);
  }
  if (present[0] === "work") {
    return checkWork(raw["work"]);
  }
  return checkStop(raw["stop"]);
}

function checkReads(value: unknown): PlanCheck {
  if (!Array.isArray(value) || value.length === 0) {
    return fieldRefusal("Plan reads", "reads", "give it at least one question");
  }
  const reads: ReadRequest[] = [];
  for (const [at, item] of value.entries()) {
    const read = readItem(item, at + 1);
    if (!read.ok) {
      return read;
    }
    reads.push(read.read);
  }
  return { ok: true, plan: { kind: "reads", reads } };
}

type ReadItem = { ok: true; read: ReadRequest } | Refusal;

function readItem(item: unknown, at: number): ReadItem {
  const where = `Plan reads item ${at}`;
  if (!isRecord(item)) {
    return refuse(`${where} is not an object.`);
  }
  const stray = strayField(item, READ_FIELDS);
  if (stray !== undefined) {
    return refuse(
      `${where} has the unknown field ${stray}; use only ${READ_FIELDS.join(", ")}.`,
    );
  }
  const question = textProblem(item["question"], TEXT_MAX);
  if (question !== undefined) {
    return fieldRefusal(where, "question", question);
  }
  const paths = checkPaths(item["paths"]);
  if (!paths.ok) {
    return fieldRefusal(where, "paths", paths.problem);
  }
  if (paths.paths.length === 0) {
    return fieldRefusal(where, "paths", "give it at least one path");
  }
  return {
    ok: true,
    read: { question: String(item["question"]), paths: paths.paths },
  };
}

function checkStop(value: unknown): PlanCheck {
  if (!isRecord(value)) {
    return refuse("Plan stop is not an object.");
  }
  const stray = strayField(value, ["reason"]);
  if (stray !== undefined) {
    return refuse(`Plan stop has the unknown field ${stray}; use only reason.`);
  }
  const problem = textProblem(value["reason"], TEXT_MAX);
  if (problem !== undefined) {
    return fieldRefusal("Plan stop", "reason", problem);
  }
  return { ok: true, plan: { kind: "stop", reason: String(value["reason"]) } };
}
