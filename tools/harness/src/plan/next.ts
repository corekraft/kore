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
      "The plan has no open item, so there is no current step to put a Next: line under. Add an unchecked item, or use `harness plan next --clear` to remove the line.",
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
  summary: "set the Next: line under the current step, or clear it",
  options: {
    plan: "string",
    text: "string",
    clear: "boolean",
    "dry-run": "boolean",
  },
  help: {
    purpose:
      "Sets the single Next: line under the current step: the first concrete action, and any state the files cannot show. The current step is the one the Next: line already names while that step has open items, else the first step with open items. Any other Next: line in the plan is removed. With --clear, removes every Next: line from the plan instead, and needs no open item.",
    when: "When the next session needs a concrete first action, with any state the files do not show, such as what is running or waiting. With --clear: when the step the Next: line named is finished, or the line no longer holds, so the plan does not show a stale action.",
    whenNot:
      "To read the line, use plan active. Setting the line needs an open item under a step, or there is no step to hold the line; --clear and --text cannot be given together.",
    flags: {
      plan: "The number of the plan to change, such as 17, needed only when more than one plan is active; otherwise the single active plan is used.",
      text: "The line's text, in quotes. Whitespace is collapsed to single spaces, and a blank text is refused.",
      clear:
        "Removes every Next: line from the plan, with the blank line after each one when one precedes it, and reports each changed line under Cleared. Cannot be combined with --text.",
      "dry-run":
        "Reports the changed lines under Would set, or under Would clear with --clear, and writes nothing.",
    },
    examples: [
      {
        command:
          'harness plan next --plan 17 --text "Write the adr help records, then run the registry specs"',
        shows:
          "the Next: line placed under the current step, any older Next: line removed, and each changed line printed under Set",
      },
      {
        command:
          'harness plan next --plan 17 --text "Write the adr help records, then run the registry specs" --dry-run',
        shows:
          "the same changes under Would set, with the plan file left as it was",
      },
      {
        command: "harness plan next --plan 17 --clear",
        shows:
          "the Next: line removed and its line numbers printed under Cleared, or No Next: line to clear when the plan has none",
      },
    ],
    exits: [
      {
        code: 0,
        meaning:
          "the line is set or cleared, or it already reads that way and nothing is written; with --dry-run, the changes are reported only",
      },
      {
        code: 1,
        meaning:
          "neither --text nor --clear, both together, the plan number is unknown or shared, no single plan is active, or the plan has no open item to hold the line; stderr names the fix",
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
        "rewrites the chosen plan file: one Next: line under the current step, and every other Next: line removed; with --clear, every Next: line removed; nothing is written when the line already reads that way or with --dry-run",
    },
    seeAlso: ["plan tick", "plan active"],
  },
  async run({ json, deps, options }) {
    const raw = options["text"];
    const plan = options["plan"];
    const planOption = typeof plan === "string" ? plan : undefined;
    const dryRun = options["dry-run"] === true;
    if (options["clear"] === true) {
      if (raw !== undefined) {
        throw new CommandError(
          "Use --text to set the Next: line or --clear to remove it, not both.",
        );
      }
      return await write(deps, json, {
        planOption,
        dryRun,
        headline: (file, dry) =>
          `${dry ? "Would clear" : "Cleared"} Next: in ${file}`,
        edits: (lines) => removals(lines),
        unchanged: "No Next: line to clear",
      });
    }
    const text = typeof raw === "string" ? normalize(raw) : "";
    if (text === "") {
      throw new CommandError(
        'Missing --text "<line>" (or --clear to remove the line): say the first concrete action and any state the files cannot show.',
      );
    }
    return await write(deps, json, {
      planOption,
      dryRun,
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
