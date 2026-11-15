import { JudgeError, renderPrBody } from "../judge/index.js";
import type { Command, CommandContext } from "../runtime/index.js";
import { failed, repoOf } from "./judge-shared.js";

const USAGE =
  "Run `harness pr open --title <title> --pattern <pattern> [--body <summary>] [--issue <n>] [--closes] [--idea <number or slug>] [--expand-step <pr>] [--base <branch>] [--head <branch>] [--dry-run] [--json]`.";

function text(context: CommandContext, name: string): string | undefined {
  const value = context.options[name];
  return typeof value === "string" && value !== "" ? value : undefined;
}

function required(context: CommandContext, name: string): string {
  const value = text(context, name);
  if (value === undefined) {
    throw new JudgeError(`Missing --${name}. ${USAGE}`);
  }
  return value;
}

function number(context: CommandContext, name: string): number | undefined {
  const value = text(context, name);
  if (value === undefined) {
    return undefined;
  }
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    throw new JudgeError(
      `--${name} must be a number such as 746, not "${value}". ${USAGE}`,
    );
  }
  return Number(value);
}

/**
 * Opens the PR with a body the declaration module rendered, so the precheck never reads a
 * hand-written declaration. gh runs through the runner in the pane's own environment, so
 * the PR is authored by the identity the pane holds. Everything is validated, and the
 * body rendered, before gh is reached: a refused contract creates no PR.
 */
export async function prOpenRun(context: CommandContext): Promise<number> {
  const { deps, json } = context;
  try {
    const title = required(context, "title");
    const pattern = required(context, "pattern");
    const issue = number(context, "issue");
    const expandStep = number(context, "expand-step");
    const idea = text(context, "idea");
    const rendered = renderPrBody({
      body: text(context, "body") ?? "",
      pattern,
      ...(issue === undefined ? {} : { issue }),
      ...(idea === undefined ? {} : { idea }),
      ...(expandStep === undefined ? {} : { expandStep }),
      ...(context.options["closes"] === true ? { closes: true } : {}),
    });
    for (const warning of rendered.warnings) {
      deps.stderr(`warning: ${warning}\n`);
    }
    if (context.options["dry-run"] === true) {
      deps.stdout(rendered.body);
      return 0;
    }
    const repo = await repoOf(context);
    const base = text(context, "base");
    const head = text(context, "head");
    const done = await deps.runner.run(
      "gh",
      [
        "pr",
        "create",
        "--repo",
        repo,
        "--title",
        title,
        "--body",
        rendered.body,
        ...(base === undefined ? [] : ["--base", base]),
        ...(head === undefined ? [] : ["--head", head]),
      ],
      { cwd: await deps.root() },
    );
    if (done.code !== 0) {
      throw new JudgeError(
        `gh pr create failed: ${done.stderr.trim()}. Check \`gh auth status\`, that the branch is pushed, and that no PR is open for it, then rerun \`harness pr open\`.`,
      );
    }
    const url = done.stdout.trim();
    deps.stdout(
      json
        ? `${JSON.stringify({ url, warnings: rendered.warnings })}\n`
        : `${url}\n`,
    );
    return 0;
  } catch (error) {
    return failed(context, error);
  }
}

export const prCommands: Record<string, Command> = {
  open: {
    summary:
      "mutates; opens a pull request whose body ends with the declaration the precheck reads, rendered from the same module that parses it: `Refs #<issue>` (or `Closes` under --closes, which warns and cites ADR 0079 beside --idea, and never refuses), `Idea:`, `Expand step: #<pr>`, then `Safety pattern:` last; refuses an expand-contract PR with no --expand-step, and a pattern or number it would not accept, before gh is reached; --dry-run prints the body and creates nothing; gh runs through the runner in this pane's environment (--title <title> --pattern <pattern> [--body <summary>] [--issue <n>] [--closes] [--idea <number or slug>] [--expand-step <pr>] [--base <branch>] [--head <branch>] [--dry-run])",
    options: {
      title: "string",
      pattern: "string",
      body: "string",
      issue: "string",
      closes: "boolean",
      idea: "string",
      "expand-step": "string",
      base: "string",
      head: "string",
      "dry-run": "boolean",
    },
    run: prOpenRun,
  },
};
