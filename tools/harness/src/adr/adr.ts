import { localDate, type Clock, type FileSystem } from "../runtime/index.js";

export const DECISIONS = "docs/decisions";
export const INDEX = "docs/index.md";
export const STATUSES = ["proposed", "accepted"] as const;

export interface NewAdr {
  title: string;
  summary: string;
  status: string;
  /** Plan path with an optional `#anchor`, from the repository root. */
  source: string;
  refines?: string;
}

export interface WrittenFile {
  path: string;
  lines: { number: number; text: string }[];
}

export interface AdrReport {
  dryRun: boolean;
  number: string;
  files: WrittenFile[];
}

/** An expected, user-correctable problem; the message names the fix. */
export class AdrError extends Error {}

function kebab(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug === "") {
    throw new AdrError(
      "--title needs at least one letter or digit; give the decision a short name.",
    );
  }
  return slug;
}

function checkSummary(summary: string): void {
  if (summary.includes("\n") || /^[[{|>&*!-]/.test(summary)) {
    throw new AdrError(
      "--summary must be one plain line that does not start with [ { | > & * ! or -; reword it as a sentence.",
    );
  }
}

function headingSlug(heading: string): string {
  return heading
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
}

/** Heading text and GitHub anchor for every heading outside code fences. */
function headings(markdown: string): { text: string; anchor: string }[] {
  const seen = new Map<string, number>();
  const found: { text: string; anchor: string }[] = [];
  let fence: string | null = null;
  for (const line of markdown.split("\n")) {
    const opener = /^\s*(```|~~~)/.exec(line)?.[1] ?? null;
    if (fence !== null || opener !== null) {
      fence = opener === fence ? null : (fence ?? opener);
      continue;
    }
    const text = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line)?.[1];
    if (text === undefined) {
      continue;
    }
    const base = headingSlug(text);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    found.push({ text, anchor: count > 0 ? `${base}-${count}` : base });
  }
  return found;
}

function adrNumber(file: string): number | null {
  const match = /^(\d{4})-.+\.md$/.exec(file);
  return match?.[1] === undefined ? null : Number(match[1]);
}

/** Creates ADRs and their index entries through the injected filesystem and clock. */
export class Adrs {
  constructor(
    private readonly fs: FileSystem,
    private readonly clock: Clock,
    private readonly root: string,
  ) {}

  async create(input: NewAdr, dryRun: boolean): Promise<AdrReport> {
    this.checkStatus(input.status);
    checkSummary(input.summary);
    const slug = kebab(input.title);
    const next =
      Math.max(
        0,
        ...(await this.fs.readdir(this.abs(DECISIONS))).map(
          (f) => adrNumber(f) ?? 0,
        ),
      ) + 1;
    const number = String(next).padStart(4, "0");
    const file = `${number}-${slug}.md`;
    const path = `${DECISIONS}/${file}`;
    const indexText = await this.readIndex();
    const date = localDate(this.clock.now());
    const body = [
      "---",
      `status: ${input.status}`,
      `summary: ${input.summary}`,
      `date: ${date}`,
      `last-verified: ${date}`,
      "---",
      "",
      `# ADR ${number}: ${input.title}`,
      "",
      `Source: ${await this.source(input.source)}`,
      ...(input.refines === undefined ? [] : ["", `Refines: ${input.refines}`]),
      "",
      "## Context",
      "",
      "## Decision",
      "",
      "## Consequences",
      "",
    ];
    const entry = `- [\`${path}\`](decisions/${file}) — ${input.summary}`;
    const index = this.insert(indexText, next, entry);
    const report: AdrReport = {
      dryRun,
      number,
      files: [
        {
          path,
          lines: body.slice(0, -1).map((text, i) => ({ number: i + 1, text })),
        },
        { path: INDEX, lines: [{ number: index.line, text: entry }] },
      ],
    };
    if (!dryRun) {
      await this.fs.writeFile(this.abs(path), body.join("\n"));
      await this.fs.writeFile(this.abs(INDEX), index.text);
    }
    return report;
  }

  private async readIndex(): Promise<string> {
    if (!(await this.fs.exists(this.abs(INDEX)))) {
      throw new AdrError(`${INDEX} is missing; restore it from git.`);
    }
    return this.fs.readFile(this.abs(INDEX));
  }

  /** Puts the entry before the first later-numbered ADR line, else after the last one. */
  private insert(text: string, next: number, entry: string) {
    const lines = text.split("\n");
    const start = lines.indexOf("## Decisions");
    if (start === -1) {
      throw new AdrError(
        `${INDEX} has no "## Decisions" heading; add it above the ADR entries.`,
      );
    }
    let end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
    if (end === -1) {
      end = lines.length;
    }
    const at = this.position(lines, start, end, next);
    lines.splice(at, 0, entry);
    return { text: lines.join("\n"), line: at + 1 };
  }

  /** Index of the line to insert at: before the first later ADR entry, else after the last. */
  private position(
    lines: string[],
    start: number,
    end: number,
    next: number,
  ): number {
    let last = -1;
    for (let i = start + 1; i < end; i++) {
      const n = /\]\(decisions\/(\d{4})-/.exec(lines[i] ?? "")?.[1];
      if (n === undefined) {
        continue;
      }
      if (Number(n) > next) {
        return i;
      }
      last = i;
    }
    if (last !== -1) {
      return last + 1;
    }
    let tail = end - 1;
    while (tail > start && lines[tail] === "") {
      tail--;
    }
    return tail + 1;
  }

  private abs(path: string): string {
    return `${this.root}/${path}`;
  }

  private checkStatus(status: string): void {
    if (status === "superseded") {
      throw new AdrError(
        "--status superseded cannot be written by adr new, which has no superseded-by to record; create the ADR as proposed or accepted, then run `harness adr supersede`.",
      );
    }
    if (!(STATUSES as readonly string[]).includes(status)) {
      throw new AdrError(
        `--status is "${status}"; use one of ${STATUSES.join(", ")}.`,
      );
    }
  }

  /** The Source link: the plan must exist and, with an anchor, so must its heading. */
  private async source(value: string): Promise<string> {
    const [path = "", anchor] = value.split("#", 2);
    if (!(await this.fs.exists(this.abs(path)))) {
      throw new AdrError(
        `--source ${path} does not exist; use a plan path from the repository root, e.g. infra/plans/<plan>.md#<heading-slug>.`,
      );
    }
    if (anchor === undefined) {
      return `[\`${path}\`](../../${path})`;
    }
    const known = headings(await this.fs.readFile(this.abs(path)));
    const hit = known.find((h) => h.anchor === anchor.toLowerCase());
    if (hit === undefined) {
      const slugs = known
        .slice(0, 5)
        .map((h) => `#${h.anchor}`)
        .join(", ");
      throw new AdrError(
        `--source #${anchor} is not a heading in ${path}; use one of its heading slugs: ${slugs}.`,
      );
    }
    const label = hit.text.split(":", 1)[0]?.trim() ?? hit.text;
    return `[\`${path}\` § ${label}](../../${path}#${anchor})`;
  }
}
