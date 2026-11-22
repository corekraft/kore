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
  help: {
    purpose:
      "Creates the next numbered ADR under docs/decisions, with its frontmatter, its title, a Source link to a plan, and empty Context, Decision and Consequences sections, and adds its entry to the Decisions section of docs/index.md.",
    when: "When a significant decision is settled and a future change would need its reason. When a plan step refines an earlier decision, record the reason in a new ADR and name the one it refines with --refines.",
    whenNot:
      "When the decision replaces an older ADR: create the new one here, then run adr supersede on the old one. Every run creates a new number, so when an ADR for the decision already exists, read docs/decisions instead. The command refuses --status superseded, which only adr supersede sets.",
    flags: {
      title:
        "The ADR's title. It names the file as a lowercase slug and becomes the heading after the number; it needs at least one letter or digit.",
      summary:
        "One plain line for the frontmatter and the index entry. It must not start with [ { | > & * ! or -.",
      status:
        "proposed or accepted. superseded is refused here, since adr supersede sets it.",
      source:
        "The plan the decision comes from: a path from the repository root with an optional #heading slug, such as infra/plans/17-harness-help-guide.md#step-1-help-guide. A slug must name a heading in that plan.",
      refines:
        "The ADR this one refines, written into its body as the Refines: line. The value is not checked, so write it as a number or a link.",
      "dry-run":
        "Reports the lines it would write, with their numbers, and creates or changes no file.",
    },
    examples: [
      {
        command:
          'harness adr new --title "Help lives beside each command" --summary "Each command declares its help where it is defined." --status accepted --source infra/plans/17-harness-help-guide.md#step-1-help-guide',
        shows:
          "the new ADR file and the docs/index.md line it adds, with their line numbers, printed under Wrote",
      },
      {
        command:
          'harness adr new --title "Help lives beside each command" --summary "Each command declares its help where it is defined." --status accepted --source infra/plans/17-harness-help-guide.md#step-1-help-guide --dry-run',
        shows: "the same two files under Would write, with no file created",
      },
    ],
    exits: [
      {
        code: 0,
        meaning:
          "the ADR and its index entry are written, or with --dry-run would be",
      },
      {
        code: 1,
        meaning:
          "a required flag is missing or blank, the status is not proposed or accepted, the summary breaks its rule, the source file or heading does not exist, or docs/index.md is missing or has no Decisions heading; stderr names the fix",
      },
      {
        code: 2,
        meaning:
          "a usage error: a flag the command does not declare, or a flag with no value",
      },
    ],
    effects: {
      kind: "mutates",
      detail:
        "creates the next docs/decisions/NNNN-<slug>.md and adds its entry to docs/index.md; with --dry-run it writes nothing",
    },
    seeAlso: ["adr supersede"],
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
  help: {
    purpose:
      "Marks one ADR superseded by a newer one: its frontmatter status becomes superseded, and a superseded-by line names the replacing ADR's file. Its body and its index entry are left as they are.",
    when: "When a newer ADR replaces an older one. Create the newer ADR with adr new first, since --new must name an ADR that exists.",
    whenNot:
      "When the older ADR still stands and is only refined: record the refinement in a new ADR with adr new --refines. When it is already superseded, the command names the ADR that replaced it and refuses; to replace that ADR, run this command on it.",
    flags: {
      old: "The number of the ADR being superseded, such as 12 or 0012.",
      new: "The number of the ADR that replaces it. It must exist and must not itself be superseded.",
      "dry-run": "Reports the two lines it would change and writes nothing.",
    },
    examples: [
      {
        command: "harness adr supersede --old 12 --new 40",
        shows:
          "ADR 0012's file with its status set to superseded and superseded-by naming ADR 0040, printed under Set",
      },
      {
        command: "harness adr supersede --old 12 --new 40 --dry-run",
        shows: "the same change under Would set, with the file left as it was",
      },
    ],
    exits: [
      {
        code: 0,
        meaning:
          "the old ADR's status is set to superseded, or with --dry-run the change is reported",
      },
      {
        code: 1,
        meaning:
          "a number is not an ADR number, an ADR is missing or its number matches more than one file, the two numbers are equal, the old ADR is already superseded or already has superseded-by, the new ADR is itself superseded, or the old frontmatter has no status; stderr names the fix",
      },
      {
        code: 2,
        meaning:
          "a usage error: a flag the command does not declare, or a flag with no value",
      },
    ],
    effects: {
      kind: "mutates",
      detail:
        "rewrites the old ADR's frontmatter: its status line becomes superseded, and a superseded-by line follows it; docs/index.md is not changed, and with --dry-run nothing is written",
    },
    seeAlso: ["adr new"],
  },
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
