import type { FileSystem } from "../runtime/index.js";
import { AdrError, DECISIONS, type WrittenFile } from "./adr.js";

export interface SupersedeReport {
  dryRun: boolean;
  old: string;
  new: string;
  files: WrittenFile[];
}

function parseNumber(flag: string, value: string): string {
  if (!/^\d{1,4}$/.test(value)) {
    throw new AdrError(
      `--${flag} must be an ADR number such as 12 or 0012; got "${value}".`,
    );
  }
  return value.padStart(4, "0");
}

/** Frontmatter line index of `key`, searching only between the opening and closing `---`. */
function frontmatterLine(lines: string[], key: string): number {
  if (lines[0] !== "---") {
    return -1;
  }
  const close = lines.indexOf("---", 1);
  const end = close === -1 ? lines.length : close;
  return lines.findIndex((l, i) => i > 0 && i < end && l.startsWith(`${key}:`));
}

interface LoadedAdr {
  path: string;
  lines: string[];
  /** Index into `lines` of the frontmatter `status:` line. */
  statusLine: number;
}

/** Marks one ADR superseded by another through the injected filesystem. */
export class Supersession {
  constructor(
    private readonly fs: FileSystem,
    private readonly root: string,
  ) {}

  async supersede(
    oldFlag: string,
    newFlag: string,
    dryRun: boolean,
  ): Promise<SupersedeReport> {
    const old = parseNumber("old", oldFlag);
    const next = parseNumber("new", newFlag);
    if (old === next) {
      throw new AdrError(
        `ADR ${old} cannot supersede itself; pass the replacing ADR's number as --new.`,
      );
    }
    const oldAdr = await this.find(old, false);
    const newAdr = await this.find(next, true);
    const oldStatus = this.status(oldAdr);
    if (oldStatus === "superseded") {
      throw new AdrError(this.alreadySuperseded(old, next, oldAdr));
    }
    if (frontmatterLine(oldAdr.lines, "superseded-by") !== -1) {
      throw new AdrError(
        `${oldAdr.path} already has superseded-by although its status is ${oldStatus}; fix the frontmatter by hand.`,
      );
    }
    if (this.status(newAdr) === "superseded") {
      throw new AdrError(
        `ADR ${next} is itself superseded; use the ADR that replaced it as --new.`,
      );
    }
    const changed = ["status: superseded", `superseded-by: ${newAdr.path}`];
    const lines = [
      ...oldAdr.lines.slice(0, oldAdr.statusLine),
      ...changed,
      ...oldAdr.lines.slice(oldAdr.statusLine + 1),
    ];
    if (!dryRun) {
      await this.fs.writeFile(this.abs(oldAdr.path), lines.join("\n"));
    }
    return {
      dryRun,
      old,
      new: next,
      files: [
        {
          path: oldAdr.path,
          lines: changed.map((text, i) => ({
            number: oldAdr.statusLine + 1 + i,
            text,
          })),
        },
      ],
    };
  }

  private alreadySuperseded(old: string, next: string, adr: LoadedAdr): string {
    const line = frontmatterLine(adr.lines, "superseded-by");
    const current = (adr.lines[line] ?? "")
      .slice("superseded-by:".length)
      .trim();
    const chained = /(\d{4})-[^/]*\.md$/.exec(current)?.[1];
    if (chained === undefined) {
      return `ADR ${old} is already superseded; fix its superseded-by line by hand.`;
    }
    return `ADR ${old} is already superseded by ${current}; to replace that ADR instead, run \`harness adr supersede --old ${chained} --new ${next}\`.`;
  }

  private status(adr: LoadedAdr): string {
    return (adr.lines[adr.statusLine] ?? "").slice("status:".length).trim();
  }

  private async find(number: string, replacement: boolean): Promise<LoadedAdr> {
    const matches = (await this.fs.readdir(this.abs(DECISIONS)))
      .filter((f) => new RegExp(`^${number}-.+\\.md$`).test(f))
      .sort();
    if (matches.length > 1) {
      throw new AdrError(
        `ADR ${number} matches more than one file: ${matches
          .map((f) => `${DECISIONS}/${f}`)
          .join(", ")}; renumber one so each ADR number is unique, then retry.`,
      );
    }
    const file = matches[0];
    if (file === undefined) {
      throw new AdrError(
        `ADR ${number} does not exist; ${
          replacement
            ? "create it first with `harness adr new`"
            : "check the number against docs/decisions/"
        }.`,
      );
    }
    const path = `${DECISIONS}/${file}`;
    const lines = (await this.fs.readFile(this.abs(path))).split("\n");
    const statusLine = frontmatterLine(lines, "status");
    if (statusLine === -1) {
      throw new AdrError(
        `${path} has no frontmatter status; add a "status:" line before superseding it.`,
      );
    }
    return { path, lines, statusLine };
  }

  private abs(path: string): string {
    return `${this.root}/${path}`;
  }
}
