import { join } from "node:path";
import {
  CommandError,
  localDate,
  type CliDeps,
  type Command,
} from "../runtime/index.js";
import { type Edit } from "./edits.js";
import { listEdits } from "./lists.js";
import { listItemSpans, type ItemSpan } from "./parser.js";
import {
  apply,
  choosePlan,
  normalize,
  renderChanges,
  toChanges,
  type Change,
} from "./plan-edit.js";
import { PLANS_DIR, readPlans } from "./store.js";

const OPEN = "- [ ]";

function chooseItem(markdown: string, wanted: string): ItemSpan {
  const needle = normalize(wanted);
  const checkbox = listItemSpans(markdown).filter((i) =>
    /^- \[[ xX]\]/.test(i.text),
  );
  const matching = checkbox.filter((i) => normalize(i.text).includes(needle));
  const open = matching.filter((i) => i.text.startsWith(OPEN));
  if (open.length === 1) {
    return open[0] as ItemSpan;
  }
  if (open.length > 1) {
    throw new CommandError(
      `"${wanted}" matches ${open.length} open items. Use a longer, more specific part of the item text.`,
    );
  }
  const done = matching.length > 0 ? " It is already ticked." : "";
  throw new CommandError(
    `"${wanted}" matches no open item.${done} Run \`harness plan active\` to see the open items.`,
  );
}

function tickEdit(lines: string[], item: ItemSpan): Edit {
  const first = lines[item.line] ?? "";
  return {
    start: item.line,
    end: item.line + 1,
    lines: [`- [x]${first.slice(OPEN.length)}`],
  };
}

function describe(
  file: string,
  step: string,
  text: string,
  dryRun: boolean,
  changes: Change[],
): string {
  return renderChanges(
    `${dryRun ? "Would tick" : "Ticked"} ${step}: ${text} in ${file}`,
    changes,
  );
}

async function tick(
  deps: CliDeps,
  json: boolean,
  item: string,
  planOption: string | undefined,
  dryRun: boolean,
): Promise<number> {
  const plans = await readPlans(deps);
  const name = choosePlan(plans, planOption);
  const markdown = plans[name] ?? "";
  const lines = markdown.split("\n");
  const span = chooseItem(markdown, item);
  const step = span.heading.split(":")[0] ?? span.heading;
  const text = normalize(span.text.slice(OPEN.length));
  const date = localDate(deps.clock.now());
  const lists = listEdits(lines, step, text, date);
  if ("error" in lists) {
    throw new CommandError(lists.error);
  }
  const edits = [tickEdit(lines, span), ...lists.edits];
  const changes = toChanges(lines, edits);
  const file = `${PLANS_DIR}/${name}`;
  if (!dryRun) {
    await deps.fs.writeFile(
      join(await deps.root(), file),
      apply(lines, edits).join("\n"),
    );
  }
  deps.stdout(
    json
      ? `${JSON.stringify({ plan: file, item: { step, text }, dryRun, written: !dryRun, changes })}\n`
      : describe(file, step, text, dryRun, changes),
  );
  return 0;
}

export const planTick: Command = {
  summary: "tick one open item and recount its list entry",
  options: { plan: "string", item: "string", "dry-run": "boolean" },
  help: {
    purpose:
      "Ticks one open item of the chosen plan: its checkbox becomes [x]. When the plan keeps the open-item lists under Where each open item can be done, the item also leaves its list entry, that entry's count drops by one, and the class totals are recounted as of today. Every changed line is reported.",
    when: "When an open item of the active plan is finished, so the plan stops showing it as open.",
    whenNot:
      "When the item is not finished yet: leave it open. To set the Next: line for the next session, use plan next. The item text must match exactly one open item, so an item already ticked, or text that matches several, is refused.",
    flags: {
      plan: "The number of the plan to tick, such as 17, needed only when more than one plan is active; otherwise the single active plan is used.",
      item: "A part of the open item's text, in quotes, that matches exactly one open item; a longer part narrows the match.",
      "dry-run":
        "Reports the changed lines under Would tick and writes nothing.",
    },
    examples: [
      {
        command: 'harness plan tick --plan 17 --item "Shrink each"',
        shows:
          "the matched item ticked, its list entry recounted, and each changed line printed under Ticked",
      },
      {
        command: 'harness plan tick --plan 17 --item "Shrink each" --dry-run',
        shows:
          "the same changed lines under Would tick, with the plan file left as it was",
      },
    ],
    exits: [
      {
        code: 0,
        meaning:
          "the item is ticked, or with --dry-run its changes are reported",
      },
      {
        code: 1,
        meaning:
          "no --item, the item matches no open item or more than one, the plan number is unknown or shared, no single plan is active, or the open-item lists cannot be recounted; stderr names the fix",
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
        "rewrites the chosen plan file under infra/plans: ticks the item, drops it from its list entry and recounts the totals; with --dry-run it writes nothing",
    },
    seeAlso: ["plan active", "plan next"],
  },
  async run({ json, deps, options }) {
    const item = options["item"];
    const plan = options["plan"];
    if (typeof item !== "string" || item.trim() === "") {
      throw new CommandError(
        'Missing --item "<text>": say which open item to tick.',
      );
    }
    return await tick(
      deps,
      json,
      item,
      typeof plan === "string" ? plan : undefined,
      options["dry-run"] === true,
    );
  },
};
