import type { Clock, FileSystem } from "../runtime/index.js";
import {
  IDEA_FILE,
  IdeaError,
  SAFETY_PATTERNS,
  parseIdea,
  renderIdea,
  withIssue,
  withOutcome,
  type IdeaRecord,
  type NewIdea,
} from "./record.js";

const INDEX = "docs/index.md";
const DIR = "docs/ideas";
const ATTEMPTS = 3;
const HEADING = "## Ideas";
const NEXT_SECTION = "## Operations and Guides";

export interface Created {
  created: boolean;
  record: IdeaRecord;
}

/** The idea records under docs/ideas and their entries in the knowledge index. */
export class IdeaRepository {
  constructor(
    private readonly fs: FileSystem,
    private readonly clock: Clock,
    /** Absolute repository root; every path below hangs from it, never the working directory. */
    private readonly root: string,
  ) {}

  async list(): Promise<IdeaRecord[]> {
    return await Promise.all((await this.listNames()).map((n) => this.read(n)));
  }

  /** Finds an idea by number (`1` or `0001`), slug, or file stem. */
  async get(ref: string): Promise<IdeaRecord> {
    const wanted = /^\d+$/.test(ref) ? ref.padStart(4, "0") : ref;
    // Match on file names so one malformed record never blocks reading another.
    const name = (await this.listNames()).find((n) => {
      const [, number, slug] = IDEA_FILE.exec(n) ?? [];
      return (
        wanted === number || wanted === slug || `${number}-${slug}` === wanted
      );
    });
    if (name === undefined) {
      throw new IdeaError(
        `No idea matches "${ref}". Run \`harness idea list\` to see the ideas, or \`harness idea new\` to create one.`,
      );
    }
    return await this.read(name);
  }

  /**
   * Creates the next numbered idea and indexes it; an existing slug is returned untouched.
   * The file is created exclusively, so a competing writer's file is never overwritten:
   * on a collision the listing is read again and the call retries.
   */
  async create(slug: string, idea: NewIdea): Promise<Created> {
    if (!(await this.fs.exists(this.abs(INDEX)))) {
      throw new IdeaError(
        `${INDEX} not found under ${this.root}; set CLAUDE_PROJECT_DIR to the repository root.`,
      );
    }
    if (!SAFETY_PATTERNS.some((p) => p === idea.safetyPattern)) {
      throw new IdeaError(
        `--safety-pattern "${idea.safetyPattern}" is not recognised; use one of ${SAFETY_PATTERNS.join(", ")}.`,
      );
    }
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const names = await this.listNames();
      const existing = names.find((n) => IDEA_FILE.exec(n)?.[2] === slug);
      if (existing !== undefined) {
        const record = await this.read(existing);
        await this.ensureIndexed(record);
        return { created: false, record };
      }
      const taken = names.map((n) => Number(n.slice(0, 4)));
      const number = String(Math.max(0, ...taken) + 1).padStart(4, "0");
      const path = `${DIR}/${number}-${slug}.md`;
      const text = renderIdea(
        number,
        this.clock.now().toISOString().slice(0, 10),
        idea,
      );
      try {
        await this.fs.createFile(this.abs(path), text);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          continue;
        }
        throw error;
      }
      const record = parseIdea(path, text);
      await this.ensureIndexed(record);
      return { created: true, record };
    }
    throw new IdeaError(
      `Another writer keeps creating ideas in ${DIR}; rerun \`harness idea new\` once it finishes.`,
    );
  }

  /** The raw markdown of an idea. */
  async source(record: IdeaRecord): Promise<string> {
    return await this.fs.readFile(this.abs(record.path));
  }

  /** Records the idea's issue link in its frontmatter, touching nothing else. */
  async recordIssue(record: IdeaRecord, issue: string): Promise<void> {
    await this.fs.writeFile(
      this.abs(record.path),
      withIssue(await this.source(record), issue),
    );
  }

  /** Records the outcome in the idea's frontmatter and as its `## Outcome` section, touching nothing else. */
  async recordOutcome(
    record: IdeaRecord,
    result: string,
    section: string,
  ): Promise<void> {
    await this.fs.writeFile(
      this.abs(record.path),
      withOutcome(await this.source(record), result, section),
    );
  }

  private abs(path: string): string {
    return `${this.root}/${path}`;
  }

  private async read(name: string): Promise<IdeaRecord> {
    const path = `${DIR}/${name}`;
    return parseIdea(path, await this.fs.readFile(this.abs(path)));
  }

  /** Lists the idea in the index unless an entry already points at it, so a rerun repairs a half-finished create. */
  private async ensureIndexed(record: IdeaRecord): Promise<void> {
    const index = await this.fs.readFile(this.abs(INDEX));
    if (!index.includes(`](${record.path.replace(/^docs\//, "")})`)) {
      await this.fs.writeFile(
        this.abs(INDEX),
        addEntry(index, record.path, record.summary),
      );
    }
  }

  private async listNames(): Promise<string[]> {
    return (await this.fs.exists(this.abs(DIR)))
      ? (await this.fs.readdir(this.abs(DIR)))
          .filter((f) => IDEA_FILE.test(f))
          .sort()
      : [];
  }
}

/** Appends an entry to the Ideas section, creating it before Operations and Guides when absent. */
function addEntry(index: string, path: string, summary: string): string {
  const entry = `- [\`${path}\`](${path.replace(/^docs\//, "")}) — ${summary}`;
  const lines = index.split("\n");
  const start = lines.indexOf(HEADING);
  if (start === -1) {
    const next = lines.indexOf(NEXT_SECTION);
    const at = next === -1 ? lines.length : next;
    const block = [HEADING, "", entry, ""];
    if (next === -1 && lines.at(-1) === "") {
      lines.splice(lines.length - 1, 0, "", ...block.slice(0, -1));
    } else {
      lines.splice(at, 0, ...block);
    }
    return lines.join("\n");
  }
  let end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  if (end === -1) {
    end = lines.length;
  }
  while (end > start + 1 && lines[end - 1] === "") {
    end--;
  }
  lines.splice(end, 0, entry);
  return lines.join("\n");
}
