import { join } from "node:path";
import { CommandError, type CliDeps, type Command } from "../runtime/index.js";
import { type Edit } from "./edits.js";
import { nextStep, openCounts } from "./parser.js";
import {
  apply,
  choosePlan,
  normalize,
  renderChanges,
  toChanges,
} from "./plan-edit.js";
import { PLANS_DIR, readPlans } from "./store.js";

const NEXT = "Next:";

/** The `Next:` paragraph at `index`, plus the blank line after it when a blank line precedes it. */
function removal(lines: string[], index: number): Edit {
  let end = index + 1;
  while (
    end < lines.length &&
    (lines[end] ?? "").trim() !== "" &&
    !(lines[end] ?? "").startsWith("#")
  ) {
    end++;
  }
  const blankBefore = index > 0 && (lines[index - 1] ?? "").trim() === "";
  if (blankBefore && end < lines.length && (lines[end] ?? "").trim() === "") {
    end++;
  }
  return { start: index, end, lines: [] };
}

function removals(lines: string[]): Edit[] {
  const edits: Edit[] = [];
  let covered = 0;
  for (const [index, line] of lines.entries()) {
    if (index >= covered && line.startsWith(NEXT)) {
      const edit = removal(lines, index);
      covered = edit.end;
      edits.push(edit);
    }
  }
  return edits;
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
  return blank
    ? { start: heading + 2, end: heading + 2, lines: [`${NEXT} ${text}`, ""] }
    : {
        start: heading + 1,
        end: heading + 1,
        lines: ["", `${NEXT} ${text}`, ""],
      };
}

function withInsertion(removed: Edit[], added: Edit): Edit[] {
  const merged = removed.find((r) => r.start === added.start);
  return merged
    ? [
        ...removed.filter((r) => r !== merged),
        { start: merged.start, end: merged.end, lines: added.lines },
      ]
    : [...removed, added];
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
