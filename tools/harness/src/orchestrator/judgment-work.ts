import {
  BRIEF_MAX,
  checkPaths,
  fieldRefusal,
  isRecord,
  refuse,
  strayField,
  textProblem,
  type PlanCheck,
  type Refusal,
  type WorkPiece,
  type WorkRole,
} from "./judgment-check.js";

const PIECE_FIELDS = ["role", "name", "brief", "files", "after"];
const NAME = /^[a-z][a-z0-9-]{0,39}$/;

/** The work list of a plan: each piece checked, then the waits between pieces. */
export function checkWork(value: unknown): PlanCheck {
  if (!Array.isArray(value) || value.length === 0) {
    return fieldRefusal("Plan work", "work", "give it at least one piece");
  }
  const work: WorkPiece[] = [];
  for (const [at, item] of value.entries()) {
    const piece = pieceOf(item, at + 1, work);
    if (!piece.ok) {
      return piece;
    }
    work.push(piece.piece);
  }
  return linkCheck(work) ?? { ok: true, plan: { kind: "work", work } };
}

type PieceResult = { ok: true; piece: WorkPiece } | Refusal;

function pieceOf(
  item: unknown,
  at: number,
  earlier: readonly WorkPiece[],
): PieceResult {
  const where = `Plan work item ${at}`;
  if (!isRecord(item)) {
    return refuse(`${where} is not an object.`);
  }
  const head = pieceHead(item, where, earlier);
  if (!head.ok) {
    return head;
  }
  const body = pieceBody(item, where);
  if (!body.ok) {
    return body;
  }
  return {
    ok: true,
    piece: { ...head.head, ...body.body },
  };
}

type HeadResult =
  { ok: true; head: { role: WorkRole; name: string } } | Refusal;

/** The object, its fields, its role and its name; a name must be new in the plan. */
function pieceHead(
  item: Record<string, unknown>,
  where: string,
  earlier: readonly WorkPiece[],
): HeadResult {
  const stray = strayField(item, PIECE_FIELDS);
  if (stray !== undefined) {
    return refuse(
      `${where} has the unknown field ${stray}; use only ${PIECE_FIELDS.join(", ")}.`,
    );
  }
  const role = item["role"];
  if (role !== "writer" && role !== "reader") {
    return fieldRefusal(where, "role", "use writer or reader");
  }
  const name = item["name"];
  if (typeof name !== "string" || !NAME.test(name)) {
    return fieldRefusal(
      where,
      "name",
      "use lowercase letters, digits and dashes, starting with a letter",
    );
  }
  const repeat = earlier.findIndex((piece) => piece.name === name);
  if (repeat !== -1) {
    return fieldRefusal(
      where,
      "name",
      `the name ${name} is already used by item ${repeat + 1}`,
    );
  }
  return { ok: true, head: { role, name } };
}

type BodyResult =
  | {
      ok: true;
      body: { brief: string; files: string[]; after: string[] };
    }
  | Refusal;

/** The brief, the files it may touch and the pieces it waits for. */
function pieceBody(item: Record<string, unknown>, where: string): BodyResult {
  const brief = textProblem(item["brief"], BRIEF_MAX);
  if (brief !== undefined) {
    return fieldRefusal(where, "brief", brief);
  }
  const files = checkPaths(item["files"]);
  if (!files.ok) {
    return fieldRefusal(where, "files", files.problem);
  }
  const after = item["after"];
  if (!isNameList(after)) {
    return fieldRefusal(where, "after", "give it a list of piece names");
  }
  return {
    ok: true,
    body: {
      brief: String(item["brief"]),
      files: files.paths,
      after,
    },
  };
}

function isNameList(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((name) => typeof name === "string")
  );
}

/** The first refusal among a plan's waits: a wait on itself, on a piece not in the plan, or a loop. */
function linkCheck(work: readonly WorkPiece[]): Refusal | undefined {
  for (const [at, piece] of work.entries()) {
    const where = `Plan work item ${at + 1}`;
    for (const target of piece.after) {
      if (target === piece.name) {
        return fieldRefusal(where, "after", "a piece cannot wait on itself");
      }
      if (!work.some((other) => other.name === target)) {
        return fieldRefusal(
          where,
          "after",
          `the piece ${target} is not in this plan`,
        );
      }
    }
  }
  for (const [at, piece] of work.entries()) {
    const loop = loopMembers(work, piece.name);
    if (loop !== undefined) {
      return fieldRefusal(
        `Plan work item ${at + 1}`,
        "after",
        `the waits form a loop through ${joinNames(loop)}`,
      );
    }
  }
  return undefined;
}

/** The pieces on a loop through `start`, in plan order; undefined when `start` waits on no loop. */
function loopMembers(
  work: readonly WorkPiece[],
  start: string,
): string[] | undefined {
  const waitsOn = (name: string): string[] =>
    work.find((piece) => piece.name === name)?.after ?? [];
  const reach = (from: string): Set<string> => {
    const seen = new Set<string>();
    const pending = [from];
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
      for (const target of waitsOn(next)) {
        if (!seen.has(target)) {
          seen.add(target);
          pending.push(target);
        }
      }
    }
    return seen;
  };
  const fromStart = reach(start);
  if (!fromStart.has(start)) {
    return undefined;
  }
  return work
    .map((piece) => piece.name)
    .filter(
      (name) =>
        name === start || (fromStart.has(name) && reach(name).has(start)),
    );
}

function joinNames(names: readonly string[]): string {
  const head = names.slice(0, -1);
  const last = names.slice(-1).join("");
  return head.length === 0 ? last : `${head.join(", ")} and ${last}`;
}
