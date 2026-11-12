import { join } from "node:path";
import {
  CommandError,
  localDate,
  type CliDeps,
  type Command,
} from "../runtime/index.js";
import { trimCommon, type Edit } from "./edits.js";
import { listEdits } from "./lists.js";
import { activePlans, listItemSpans, type ItemSpan } from "./parser.js";
import { PLANS_DIR, readPlans } from "./store.js";

const OPEN = "- [ ]";

interface Change {
  line: number;
  before: string[];
  after: string[];
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function choosePlan(
  plans: Record<string, string>,
  requested: string | undefined,
): string {
  const names = Object.keys(plans);
  if (requested !== undefined) {
    const named = /^\d+$/.test(requested)
      ? names.filter((n) => n.startsWith(`${requested}-`))
      : [];
    if (named.length > 1) {
      throw new CommandError(
        `Plan number "${requested}" is shared by ${named.join(" and ")}. Rename one so each plan number is unique.`,
      );
    }
    const name = named[0];
    if (name === undefined) {
      throw new CommandError(
        `No plan numbered "${requested}" in ${PLANS_DIR}. Run \`harness plan active\` to list the plans.`,
      );
    }
    return name;
  }
  const active = activePlans(plans);
  if (active.length === 0) {
    throw new CommandError(
      `No active plan to tick in: no file in ${PLANS_DIR} has "status: active". Name one with --plan N.`,
    );
  }
  if (active.length > 1) {
    throw new CommandError(
      `${active.length} plans are active (${active.join(", ")}), so there is no single default. Pass --plan N.`,
    );
  }
  return active[0] ?? "";
}

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

function apply(lines: string[], edits: Edit[]): string[] {
  const out = [...lines];
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    out.splice(edit.start, edit.end - edit.start, ...edit.lines);
  }
  return out;
}

function toChanges(lines: string[], edits: Edit[]): Change[] {
  return edits
    .flatMap((edit) => trimCommon(edit, lines) ?? [])
    .sort((a, b) => a.start - b.start)
    .map((edit) => ({
      line: edit.start + 1,
      before: lines.slice(edit.start, edit.end),
      after: edit.lines,
    }));
}

function describe(
  file: string,
  step: string,
  text: string,
  dryRun: boolean,
  changes: Change[],
): string {
  const head = `${dryRun ? "Would tick" : "Ticked"} ${step}: ${text} in ${file}`;
  const body = changes.flatMap((c) => [
    `  line ${c.line}:`,
    ...c.before.map((l) => `  - ${l}`),
    ...c.after.map((l) => `  + ${l}`),
  ]);
  return `${[head, ...body].join("\n")}\n`;
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
