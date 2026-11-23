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
import { pieceNameProblem } from "./tick-piece.js";

export { BRIEF_MAX, TEXT_MAX } from "./judgment-check.js";
export type {
  Plan,
  ReadRequest,
  WorkPiece,
  WorkRole,
} from "./judgment-check.js";

const TOP_KEYS = ["reads", "work", "stop"];
const READ_FIELDS = ["question", "paths"];

export type PlanRead =
  { ok: true; raw: unknown } | { ok: false; error: string };

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

/**
 * A work plan whose piece pane name `session spawn` would refuse is refused whole, as any bad plan is, so
 * the judgment gets its one retry before the idea is labelled. Other plans and refusals pass unchanged.
 */
export function checkNames(idea: string, checked: PlanCheck): PlanCheck {
  if (!checked.ok || checked.plan.kind !== "work") {
    return checked;
  }
  const problem = pieceNameProblem(idea, checked.plan.work);
  return problem === undefined ? checked : refuse(problem);
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
