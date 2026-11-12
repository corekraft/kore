import { join } from "node:path";
import { CommandError, type CliDeps, type Command } from "../runtime/index.js";
import { type Edit } from "./edits.js";
import { nextBlocks, nextStep, openCounts } from "./parser.js";
import {
  apply,
  choosePlan,
  normalize,
  renderChanges,
  toChanges,
} from "./plan-edit.js";
import { PLANS_DIR, readPlans } from "./store.js";

const NEXT = "Next:";

/** Removals of every `Next:` paragraph, each with the blank line after it when a blank line precedes it. */
function removals(lines: string[]): Edit[] {
  return nextBlocks(lines.join("\n")).map(({ line, end }) => {
    const blankBefore = line > 0 && (lines[line - 1] ?? "").trim() === "";
    const blankAfter = end < lines.length && (lines[end] ?? "").trim() === "";
    return {
      start: line,
      end: blankBefore && blankAfter ? end + 1 : end,
      lines: [],
    };
  });
}

/** Index of the `##` heading of the current step: where the `Next:` line is, else the first step with open items. */
function currentHeading(lines: string[], markdown: string): number {
  const open = openCounts(markdown).map((c) => c.step);
  const held = nextStep(markdown)?.step.split(":")[0];
  const step = held !== undefined && open.includes(held) ? held : open[0];
  const index = lines.findIndex(
    (l) => l.startsWith("## ") && l.slice(3).trim().split(":")[0] === step,
  );
  if (step === undefined || index < 0) {
    throw new CommandError(
      "The plan has no open item, so there is no current step to put a Next: line under. Add an unchecked item, or use `harness plan clear-next`.",
    );
  }
  return index;
}

function insertion(lines: string[], heading: number, text: string): Edit {
  const blank = (lines[heading + 1] ?? "").trim() === "";
  const start = blank ? heading + 2 : heading + 1;
  return {
    start,
    end: start,
    lines: blank ? [`${NEXT} ${text}`, ""] : ["", `${NEXT} ${text}`, ""],
  };
}

/** Put the insertion where a removal begins (replacing it), never leaving two blank lines in a row. */
function withInsertion(lines: string[], removed: Edit[], added: Edit): Edit[] {
  const merged = removed.find((r) => r.start === added.start);
  const end = merged?.end ?? added.start;
  const followedByBlank = (lines[end] ?? "").trim() === "";
  const inserted =
    followedByBlank && added.lines.at(-1) === ""
      ? added.lines.slice(0, -1)
      : added.lines;
  return merged
    ? [
        ...removed.filter((r) => r !== merged),
        { start: merged.start, end: merged.end, lines: inserted },
      ]
    : [...removed, { ...added, lines: inserted }];
}

async function write(
  deps: CliDeps,
  json: boolean,
  options: {
    planOption: string | undefined;
    dryRun: boolean;
    headline: (file: string, dryRun: boolean) => string;
    edits: (lines: string[], markdown: string) => Edit[];
    unchanged: string;
  },
): Promise<number> {
  const plans = await readPlans(deps);
  const name = choosePlan(plans, options.planOption);
  const markdown = plans[name] ?? "";
  const lines = markdown.split("\n");
  const edits = options.edits(lines, markdown);
  const changes = toChanges(lines, edits);
  const file = `${PLANS_DIR}/${name}`;
  const written = !options.dryRun && changes.length > 0;
  if (written) {
    await deps.fs.writeFile(
      join(await deps.root(), file),
      apply(lines, edits).join("\n"),
    );
  }
  if (json) {
    deps.stdout(
      `${JSON.stringify({ plan: file, dryRun: options.dryRun, written, changes })}\n`,
    );
  } else if (changes.length === 0) {
    deps.stdout(`${options.unchanged} in ${file}\n`);
  } else {
    deps.stdout(renderChanges(options.headline(file, options.dryRun), changes));
  }
  return 0;
}

export const planNext: Command = {
  summary:
    'set the single Next: line under the current step (--text "<line>" [--plan N] [--dry-run]) and remove any other, reporting every changed line',
  options: { plan: "string", text: "string", "dry-run": "boolean" },
  async run({ json, deps, options }) {
    const raw = options["text"];
    const plan = options["plan"];
    const text = typeof raw === "string" ? normalize(raw) : "";
    if (text === "") {
      throw new CommandError(
        'Missing --text "<line>": say the first concrete action and any state the files cannot show.',
      );
    }
    return await write(deps, json, {
      planOption: typeof plan === "string" ? plan : undefined,
      dryRun: options["dry-run"] === true,
      headline: (file, dry) => `${dry ? "Would set" : "Set"} Next: in ${file}`,
      edits: (lines, markdown) =>
        withInsertion(
          lines,
          removals(lines),
          insertion(lines, currentHeading(lines, markdown), text),
        ),
      unchanged: `Next: already reads that way`,
    });
  },
};

export const planClearNext: Command = {
  summary:
    "remove the Next: line ([--plan N] [--dry-run]) and report every changed line",
  options: { plan: "string", "dry-run": "boolean" },
  async run({ json, deps, options }) {
    const plan = options["plan"];
    return await write(deps, json, {
      planOption: typeof plan === "string" ? plan : undefined,
      dryRun: options["dry-run"] === true,
      headline: (file, dry) =>
        `${dry ? "Would clear" : "Cleared"} Next: in ${file}`,
      edits: (lines) => removals(lines),
      unchanged: "No Next: line to clear",
    });
  },
};
