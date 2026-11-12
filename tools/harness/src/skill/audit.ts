import type { FileSystem } from "../runtime/index.js";

export const DESCRIPTION_BUDGET = 200;
export const BODY_BUDGET = 25;

export type Budget = "description" | "body";
export type Verdict = "ok" | "over-budget" | "invalid";

export interface SkillRow {
  name: string;
  /** The skill's directory under skills/, which is its name unless the frontmatter renames it. */
  directory: string;
  descriptionChars: number;
  bodyLines: number;
  verdict: Verdict;
  over?: Budget[];
  reason?: string;
}

export interface AuditReport {
  skills: SkillRow[];
  summary: Record<Verdict, number>;
}

function invalid(name: string, reason: string): SkillRow {
  return {
    name,
    directory: name,
    descriptionChars: 0,
    bodyLines: 0,
    verdict: "invalid",
    reason,
  };
}

function field(frontmatter: string, key: string): string | undefined {
  const line = frontmatter.split("\n").find((l) => l.startsWith(`${key}:`));
  const value = line?.slice(key.length + 1).trim();
  if (value === undefined || value === "") {
    return undefined;
  }
  return value.replace(/^(["'])(.*)\1$/, "$2");
}

function overBudgets(descriptionChars: number, bodyLines: number): Budget[] {
  const over: Budget[] = [];
  if (descriptionChars > DESCRIPTION_BUDGET) {
    over.push("description");
  }
  if (bodyLines > BODY_BUDGET) {
    over.push("body");
  }
  return over;
}

function countLines(body: string): number {
  return body === "" ? 0 : body.replace(/\n$/, "").split("\n").length;
}

/** Measures one SKILL.md; never throws on malformed content. */
export function auditSkill(directory: string, text: string): SkillRow {
  const source = text.replaceAll("\r\n", "\n");
  if (!source.startsWith("---\n")) {
    return invalid(directory, "missing frontmatter");
  }
  const close = /\n---[ \t]*(\n|$)/.exec(source.slice(3));
  if (close === null) {
    return invalid(directory, "unterminated frontmatter");
  }
  const end = close.index + 3;
  const frontmatter = source.slice(4, end);
  const name = field(frontmatter, "name");
  if (name === undefined) {
    return invalid(directory, "missing name");
  }
  const description = field(frontmatter, "description");
  if (description === undefined) {
    return invalid(directory, "missing description");
  }
  if (/^[>|][+-]?$/.test(description)) {
    return invalid(directory, "multi-line description");
  }
  const bodyLines = countLines(source.slice(end + close[0].length));
  const over = overBudgets(description.length, bodyLines);
  const row: SkillRow = {
    name,
    directory,
    descriptionChars: description.length,
    bodyLines,
    verdict: over.length > 0 ? "over-budget" : "ok",
  };
  return over.length > 0 ? { ...row, over } : row;
}

/** Audits every `<skillsDir>/<name>/SKILL.md`; directories without one are not skills. */
export async function auditSkills(
  fs: FileSystem,
  skillsDir: string,
): Promise<AuditReport> {
  const rows: SkillRow[] = [];
  for (const directory of await fs.readdir(skillsDir)) {
    const path = `${skillsDir}/${directory}/SKILL.md`;
    if (await fs.exists(path)) {
      rows.push(auditSkill(directory, await fs.readFile(path)));
    }
  }
  rows.sort((a, b) => a.name.localeCompare(b.name, "en"));
  const summary: Record<Verdict, number> = {
    ok: 0,
    "over-budget": 0,
    invalid: 0,
  };
  for (const row of rows) {
    summary[row.verdict] += 1;
  }
  return { skills: rows, summary };
}

function detail(row: SkillRow): string {
  if (row.verdict === "over-budget") {
    return ` (${(row.over ?? []).join(", ")})`;
  }
  return row.verdict === "invalid" ? ` (${row.reason ?? ""})` : "";
}

export function renderReport(report: AuditReport): string {
  const width = Math.max(4, ...report.skills.map((s) => s.name.length));
  const lines = [
    `${"NAME".padEnd(width)}  DESC  BODY  VERDICT`,
    ...report.skills.map(
      (s) =>
        `${s.name.padEnd(width)}  ${String(s.descriptionChars).padStart(4)}  ${String(s.bodyLines).padStart(4)}  ${s.verdict}${detail(s)}`,
    ),
    "",
    `${report.summary.ok} ok, ${report.summary["over-budget"]} over-budget, ${report.summary.invalid} invalid`,
  ];
  return `${lines.join("\n")}\n`;
}
