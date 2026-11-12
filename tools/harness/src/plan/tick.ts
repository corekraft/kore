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
  summary:
    'tick one open item (--item "<text>" [--plan N] [--dry-run]), update the open-item lists and counts, and report every changed line',
  options: { plan: "string", item: "string", "dry-run": "boolean" },
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
