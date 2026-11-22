import { JudgeError, renderPrBody } from "../judge/index.js";
import type {
  CliDeps,
  Command,
  CommandContext,
  CommandHelp,
} from "../runtime/index.js";
import { signedBody } from "../sender/index.js";
import { failed, repoOf } from "./judge-shared.js";
import { prCheckCommand } from "./pr-check-command.js";
import { prChecksRun } from "./pr-checks-command.js";
import { linkPullRequest } from "./pr-link.js";
import { readPrBody } from "./pr-open-body.js";

const USAGE =
  "Run `harness pr open --title <title> --pattern <pattern> [--body <summary> | --body-file <path>] [--issue <n>] [--closes] [--idea <number or slug, or none>] [--expand-step <pr>] [--base <branch>] [--head <branch>] [--dry-run] [--json]`.";

/** The idea a pull request serves none of: no `Idea:` line, and `none` on its pr.linked event (ADR 0126). */
const NONE = "none";

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

/** The PR body with its sender line first; refused when the environment cannot name the sender or the body carries approval syntax. */
function signedPrBody(context: CommandContext, body: string): string {
  const signed = signedBody(context.deps.env, "pr open", body);
  if ("error" in signed) {
    throw new JudgeError(signed.error);
  }
  return signed.body;
}

/**
 * Links the pull request gh just opened to its writer and the idea it serves, then prints its
 * URL. A link problem is a warning on stderr: it never fails the open, because the pull request
 * already exists.
 */
async function reportOpened(
  deps: CliDeps,
  json: boolean,
  url: string,
  warnings: readonly string[],
  idea: string,
): Promise<void> {
  const linkWarning = await linkPullRequest(deps, url, idea);
  if (linkWarning !== undefined) {
    deps.stderr(`warning: ${linkWarning}\n`);
  }
  deps.stdout(json ? `${JSON.stringify({ url, warnings })}\n` : `${url}\n`);
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
    const idea = text(context, "idea") ?? NONE;
    const rendered = renderPrBody({
      body: await readPrBody(
        { inline: context.options["body"], file: context.options["body-file"] },
        { fs: deps.fs, cwd: deps.cwd },
      ),
      pattern,
      ...(issue === undefined ? {} : { issue }),
      ...(idea === NONE ? {} : { idea }),
      ...(expandStep === undefined ? {} : { expandStep }),
      ...(context.options["closes"] === true ? { closes: true } : {}),
    });
    const body = signedPrBody(context, rendered.body);
    for (const warning of rendered.warnings) {
      deps.stderr(`warning: ${warning}\n`);
    }
    if (context.options["dry-run"] === true) {
      deps.stdout(body);
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
        body,
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
    await reportOpened(deps, json, done.stdout.trim(), rendered.warnings, idea);
    return 0;
  } catch (error) {
    return failed(context, error);
  }
}

const checksHelp: CommandHelp = {
  purpose:
    "Reads the check runs on a pull request through gh and says whether they are green, red or pending. With --wait it polls on a clock until the checks settle or about nine minutes pass.",
  when: "When you need a PR's CI state now, or need to wait for it before the next step.",
  whenNot:
    "When you need the writer's view of what to fix, with the judge's precheck applied: use pr check. To wait on several things at once, use harness wait.",
  flags: {
    wait: "Polls the checks every 15 seconds until they settle or about nine minutes pass; without it, reads them once.",
  },
  operand: "The pull request number, such as 746.",
  examples: [
    {
      command: "harness pr checks 746",
      shows:
        "PR 746's checks read once: green when all pass, red naming the failed checks, pending while they run",
    },
    {
      command: "harness pr checks 746 --wait",
      shows: "the same, polled until the checks settle or the bound passes",
    },
    {
      command: "harness pr checks 746 --json",
      shows:
        "the state, the failed and pending check names and each check, as one object",
    },
  ],
  exits: [
    { code: 0, meaning: "every check passed" },
    {
      code: 1,
      meaning:
        "a check failed, or the PR could not be read: no PR number, or gh failed or returned unreadable output",
    },
    {
      code: 2,
      meaning:
        "checks are still pending: after one read, or at the bound with --wait; poll again with ledger poll-github",
    },
  ],
  effects: {
    kind: "read-only",
    detail:
      "reads the PR's check runs through gh and writes nothing; --wait only sleeps between reads",
  },
  seeAlso: ["pr check", "harness wait", "ledger poll-github"],
};

const openHelp: CommandHelp = {
  purpose:
    "Opens a pull request whose body ends with the declaration the judge's precheck reads, rendered from the same module that parses it, and refuses before gh is reached any title, pattern or body it cannot use.",
  when: "When a writer's branch is pushed and its change is ready for the judge.",
  whenNot:
    "When a PR for the branch is already open: gh refuses a second one, so check the open PR with pr check. To see the body without opening anything, add --dry-run.",
  flags: {
    title: "The pull request title, passed to gh. Required.",
    pattern:
      "The safety pattern the change declares: no-behaviour-change, feature-flagged, dark-launched, branch-by-abstraction or expand-contract. Required.",
    body: "The body summary, given inline. Cannot be given with --body-file.",
    "body-file":
      "A path, relative to the working directory, to read the body from exactly as the file holds it. Cannot be given with --body.",
    issue:
      "The issue number the PR refs, written as Refs #n, or as Closes with --closes.",
    closes:
      "Writes Closes instead of Refs. Beside --idea it warns, citing ADR 0079; it is never refused.",
    idea: "The idea the PR serves, by number or slug, written as an Idea: line. none, the default, writes no Idea line and records none on the link.",
    "expand-step":
      "The merged expand PR's number. Required for expand-contract, and refused for any other pattern.",
    base: "The base branch, passed to gh pr create.",
    head: "The head branch, passed to gh pr create.",
    "dry-run": "Prints the body that would be posted and creates nothing.",
  },
  examples: [
    {
      command:
        "harness pr open --title 'Document the pr domain' --pattern no-behaviour-change --issue 1797 --body 'Help records for the pr commands.'",
      shows:
        "the PR URL printed once gh has opened it, with the body's Refs line and sender line",
    },
    {
      command:
        "harness pr open --title 'Split the flag work' --pattern expand-contract --expand-step 812 --body-file summary.md --dry-run",
      shows:
        "the body that would be posted, ending with its Safety pattern line, and nothing opened",
    },
  ],
  exits: [
    {
      code: 0,
      meaning:
        "the PR is open and its URL printed; with --dry-run, the body printed and nothing created",
    },
    {
      code: 1,
      meaning:
        "refused before gh was reached, or gh failed: a missing --title or --pattern, a number that is not a whole number of at least one, an expand-contract PR without --expand-step (or --expand-step on another pattern), both body flags, a body file that cannot be read, a body with approval syntax, or no sender the environment can name; or gh pr create failed",
    },
  ],
  effects: {
    kind: "mutates",
    detail:
      "opens a PR through gh in the repository, its body led by the sender line; when this pane is a writer, appends one pr.linked ledger event (PR number, session, idea), and a failed link is only a warning on stderr. --dry-run and every refusal change nothing",
  },
  seeAlso: ["pr check", "pr checks", "session spawn"],
};

export const prCommands: Record<string, Command> = {
  checks: {
    summary:
      "Reads a pull request's check runs and says whether they are green, red or pending.",
    operand: "pr",
    options: { wait: "boolean" },
    help: checksHelp,
    run: prChecksRun,
  },
  check: prCheckCommand,
  open: {
    summary:
      "Opens a pull request with its declared safety pattern and the body the judge's precheck reads.",
    options: {
      title: "string",
      pattern: "string",
      body: "string",
      "body-file": "string",
      issue: "string",
      closes: "boolean",
      idea: "string",
      "expand-step": "string",
      base: "string",
      head: "string",
      "dry-run": "boolean",
    },
    help: openHelp,
    run: prOpenRun,
  },
};
