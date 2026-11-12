import { CommandError } from "../runtime/index.js";
import { trimCommon, type Edit } from "./edits.js";
import { activePlans } from "./parser.js";
import { PLANS_DIR } from "./store.js";

// Plan choice and line-edit helpers shared by the plan commands that write.

export interface Change {
  line: number;
  before: string[];
  after: string[];
}

export function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function choosePlan(
  plans: Record<string, string>,
  requested: string | undefined,
): string {
  const names = Object.keys(plans);
  if (requested !== undefined) {
    const named = /^\d+$/.test(requested)
      ? names.filter((n) => n.startsWith(`${requested}-`))
      : [];
    if (named.length > 1) {
      throw new CommandError(
        `Plan number "${requested}" is shared by ${named.join(" and ")}. Rename one so each plan number is unique.`,
      );
    }
    const name = named[0];
    if (name === undefined) {
      throw new CommandError(
        `No plan numbered "${requested}" in ${PLANS_DIR}. Run \`harness plan active\` to list the plans.`,
      );
    }
    return name;
  }
  const active = activePlans(plans);
  if (active.length === 0) {
    throw new CommandError(
      `No active plan to tick in: no file in ${PLANS_DIR} has "status: active". Name one with --plan N.`,
    );
  }
  if (active.length > 1) {
    throw new CommandError(
      `${active.length} plans are active (${active.join(", ")}), so there is no single default. Pass --plan N.`,
    );
  }
  return active[0] ?? "";
}

export function apply(lines: string[], edits: Edit[]): string[] {
  const out = [...lines];
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    out.splice(edit.start, edit.end - edit.start, ...edit.lines);
  }
  return out;
}

export function toChanges(lines: string[], edits: Edit[]): Change[] {
  return edits
    .flatMap((edit) => trimCommon(edit, lines) ?? [])
    .sort((a, b) => a.start - b.start)
    .map((edit) => ({
      line: edit.start + 1,
      before: lines.slice(edit.start, edit.end),
      after: edit.lines,
    }));
}

/** A headline followed by every changed line as `-` and `+` rows. */
export function renderChanges(head: string, changes: Change[]): string {
  const body = changes.flatMap((c) => [
    `  line ${c.line}:`,
    ...c.before.map((l) => `  - ${l}`),
    ...c.after.map((l) => `  + ${l}`),
  ]);
  return `${[head, ...body].join("\n")}\n`;
}
