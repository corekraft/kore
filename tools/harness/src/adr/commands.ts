import type { Command } from "../runtime/index.js";
import { AdrError, Adrs, type AdrReport } from "./adr.js";

const REQUIRED = ["title", "summary", "status", "source"] as const;

function describe(report: AdrReport): string {
  const verb = report.dryRun ? "Would write" : "Wrote";
  return `${report.files
    .map(
      (f) =>
        `${verb} ${f.path} (lines ${f.lines[0]?.number}-${f.lines.at(-1)?.number})`,
    )
    .join("\n")}\n`;
}

const newAdr: Command = {
  summary:
    "create the next ADR and its index entry (--title --summary --status --source [--refines] [--dry-run])",
  options: {
    title: "string",
    summary: "string",
    status: "string",
    source: "string",
    refines: "string",
    "dry-run": "boolean",
  },
  async run({ json, options, deps }) {
    try {
      const value = (key: string): string => {
        const v = options[key];
        if (typeof v !== "string" || v.trim() === "") {
          throw new AdrError(`--${key} is required; pass --${key} <text>.`);
        }
        return v.trim();
      };
      const [title, summary, status, source] = REQUIRED.map(value) as [
        string,
        string,
        string,
        string,
      ];
      const refines =
        typeof options["refines"] === "string"
          ? options["refines"].trim()
          : undefined;
      const root = await deps.root().catch((cause: unknown) => {
        throw new AdrError(
          cause instanceof Error ? cause.message : String(cause),
        );
      });
      const report = await new Adrs(deps.fs, deps.clock, root).create(
        { title, summary, status, source, ...(refines ? { refines } : {}) },
        options["dry-run"] === true,
      );
      deps.stdout(json ? `${JSON.stringify(report)}\n` : describe(report));
      return 0;
    } catch (error) {
      if (!(error instanceof AdrError)) {
        throw error;
      }
      deps.stderr(
        json
          ? `${JSON.stringify({ error: error.message })}\n`
          : `${error.message}\n`,
      );
      return 1;
    }
  },
};

export const adrCommands: Record<string, Command> = { new: newAdr };
