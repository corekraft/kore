import type { Command } from "../runtime/index.js";
import { AdrError, Adrs, type AdrReport } from "./adr.js";
import { Supersession } from "./supersede.js";

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

type Deps = Parameters<Command["run"]>[0]["deps"];

function requiredFlag(
  options: Record<string, unknown>,
  key: string,
  hint: string,
): string {
  const v = options[key];
  if (typeof v !== "string" || v.trim() === "") {
    throw new AdrError(`--${key} is required; pass --${key} <${hint}>.`);
  }
  return v.trim();
}

function repoRoot(deps: Deps): Promise<string> {
  return deps.root().catch((cause: unknown) => {
    throw new AdrError(cause instanceof Error ? cause.message : String(cause));
  });
}

/** Runs a command body, turning an expected AdrError into exit code 1. */
async function withAdrErrors(
  json: boolean,
  deps: Deps,
  body: () => Promise<number>,
): Promise<number> {
  try {
    return await body();
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
  run: ({ json, options, deps }) =>
    withAdrErrors(json, deps, async () => {
      const [title, summary, status, source] = REQUIRED.map((key) =>
        requiredFlag(options, key, "text"),
      ) as [string, string, string, string];
      const refines =
        typeof options["refines"] === "string"
          ? options["refines"].trim()
          : undefined;
      const root = await repoRoot(deps);
      const report = await new Adrs(deps.fs, deps.clock, root).create(
        { title, summary, status, source, ...(refines ? { refines } : {}) },
        options["dry-run"] === true,
      );
      deps.stdout(json ? `${JSON.stringify(report)}\n` : describe(report));
      return 0;
    }),
};

const supersede: Command = {
  summary: "mark an ADR superseded by another (--old N --new M [--dry-run])",
  options: { old: "string", new: "string", "dry-run": "boolean" },
  run: ({ json, options, deps }) =>
    withAdrErrors(json, deps, async () => {
      const root = await repoRoot(deps);
      const report = await new Supersession(deps.fs, root).supersede(
        requiredFlag(options, "old", "number"),
        requiredFlag(options, "new", "number"),
        options["dry-run"] === true,
      );
      const verb = report.dryRun ? "Would set" : "Set";
      deps.stdout(
        json
          ? `${JSON.stringify(report)}\n`
          : `${verb} ${report.files[0]?.path} to status superseded, superseded-by ADR ${report.new}\n`,
      );
      return 0;
    }),
};

export const adrCommands: Record<string, Command> = {
  new: newAdr,
  supersede,
};
