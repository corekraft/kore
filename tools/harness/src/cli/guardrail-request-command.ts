// `harness guardrail request`: asks a person to approve a guardrail mode
// change, on the idea's issue, with the idea's outcome evidence (ADR 0080).
// It only comments and records a ledger event; it never changes a mode.
// Plan: infra/plans/12-self-improving-loop.md (Step 4).
import {
  GuardrailError,
  evidenceSource,
  guardrailCommands,
  isTarget,
  marker,
  readInventory,
  renderRequest,
  requestLabel,
  waitingRequests,
  REQUEST_KIND,
  TARGETS,
  type Guardrail,
  type Inventory,
  type Target,
} from "../guardrail/index.js";
import { IdeaError, IdeaRepository, issueTarget } from "../idea/index.js";
import type { Ledger } from "../ledger/index.js";
import { RulesetError } from "../ruleset/index.js";
import {
  CommandError,
  type Command,
  type CommandContext,
} from "../runtime/index.js";
import { gatherEvidence } from "./guardrail-request-evidence.js";
import { openLedger } from "./ledger-commands.js";

const FAILED = 1;
const FIX = "Check `gh auth status`, then rerun `harness guardrail request`.";

type Issue = { number: string; repo: string };

function text(options: CommandContext["options"], key: string) {
  const value = options[key];
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function required(context: CommandContext, key: string): string {
  const value = text(context.options, key);
  if (value === undefined) {
    throw new GuardrailError(
      `Missing --${key}; run \`harness guardrail request --rule <rule> --to <enforce|audit|remove> --idea <number or slug>\`.`,
    );
  }
  return value;
}

function target(to: string): Target {
  if (!isTarget(to)) {
    throw new GuardrailError(
      `--to must be ${TARGETS.slice(0, -1).join(", ")} or ${TARGETS.at(-1)}; got "${to}". Rerun with one of them.`,
    );
  }
  return to;
}

/** The rule to change, or the fix for a rule that is unknown or already in the requested state. */
function changeable(inventory: Inventory, rule: string, to: Target): Guardrail {
  const guardrail = inventory.guardrails.find((g) => g.rule === rule);
  if (guardrail === undefined) {
    throw new GuardrailError(
      `${rule} is not in .claude/guardrails.yaml. Rerun with one of: ${inventory.guardrails.map((g) => g.rule).join(", ")}.`,
    );
  }
  if (guardrail.mode === to) {
    throw new GuardrailError(
      `${rule} is already in ${to} mode, so there is nothing to approve. Rerun with a different --to.`,
    );
  }
  return guardrail;
}

async function gh(
  { deps }: CommandContext,
  args: string[],
  what: string,
  input?: string,
): Promise<string> {
  const done = await deps.runner.run("gh", args, {
    cwd: await deps.root(),
    ...(input === undefined ? {} : { input }),
  });
  if (done.code !== 0) {
    throw new GuardrailError(
      `gh ${what} failed: ${done.stderr.trim()}. ${FIX}`,
    );
  }
  return done.stdout;
}

async function hasComment(
  context: CommandContext,
  issue: Issue,
  wanted: string,
): Promise<boolean> {
  const stdout = await gh(
    context,
    ["issue", "view", issue.number, "--repo", issue.repo, "--json", "comments"],
    `issue view for issue ${issue.number}`,
  );
  try {
    const { comments = [] } = JSON.parse(stdout) as {
      comments?: { body?: string }[];
    };
    return comments.some((c) => c.body?.includes(wanted) === true);
  } catch {
    throw new GuardrailError(
      `gh returned unreadable output for issue ${issue.number}. ${FIX}`,
    );
  }
}

/** Posts the comment unless the issue already holds this request's marker; true when it posted. */
async function post(
  context: CommandContext,
  issue: Issue,
  requestId: string,
  body: string,
): Promise<boolean> {
  if (await hasComment(context, issue, marker(requestId))) {
    return false;
  }
  await gh(
    context,
    [
      "issue",
      "comment",
      issue.number,
      "--repo",
      issue.repo,
      "--body-file",
      "-",
    ],
    `issue comment for issue ${issue.number}`,
    body,
  );
  return true;
}

async function record(
  { deps }: CommandContext,
  ledger: Ledger,
  event: { id: string; idea: string; label: string },
): Promise<void> {
  const logged = await ledger.record({
    source: "claude",
    kind: REQUEST_KIND,
    occurredAt: deps.clock.now().toISOString(),
    ...event,
  });
  if (!logged.ok) {
    throw new GuardrailError(
      `The request could not be recorded: ${logged.message} Fix the ledger, then rerun \`harness guardrail request\`.`,
    );
  }
}

/**
 * The request to post: the one already waiting for this rule, target and idea,
 * else a new one, recorded now. It is recorded before it is posted, so a rerun
 * after a failed post finds it waiting and posts the same request.
 */
async function begin(
  context: CommandContext,
  ledger: Ledger,
  inventory: Inventory,
  { rule, to, idea }: { rule: string; to: Target; idea: string },
): Promise<{ requestId: string; same: boolean }> {
  const waiting = (await waitingRequests(context.deps, inventory, ledger)).get(
    rule,
  );
  if (waiting?.to === to && waiting.idea === idea) {
    return { requestId: waiting.id, same: true };
  }
  const requestId = context.deps.ids.next();
  await record(context, ledger, {
    id: requestId,
    idea,
    label: requestLabel(rule, to),
  });
  return { requestId, same: false };
}

async function request(context: CommandContext): Promise<number> {
  const { deps } = context;
  const rule = required(context, "rule");
  const to = target(required(context, "to"));
  const ideaRef = required(context, "idea");
  const root = await deps.root();
  const inventory = await readInventory((p) => deps.fs.readFile(p), root);
  const guardrail = changeable(inventory, rule, to);
  const measured = evidenceSource(guardrail);
  if ("refusal" in measured) {
    throw new GuardrailError(measured.refusal);
  }
  const opened = await openLedger(context);
  if ("error" in opened) {
    throw new GuardrailError(opened.error);
  }
  const idea = await new IdeaRepository(deps.fs, deps.clock, root).get(ideaRef);
  const issue = await issueTarget(deps.runner, root, idea);
  const evidence = await gatherEvidence(context, guardrail, measured.source);
  const { requestId, same } = await begin(context, opened.ledger, inventory, {
    rule,
    to,
    idea: idea.number,
  });
  const link = `https://github.com/${issue.repo}/issues/${issue.number}`;
  const commented = await post(
    context,
    issue,
    requestId,
    renderRequest({
      guardrail,
      to,
      requestId,
      idea: { number: idea.number, title: idea.title, path: idea.path, link },
      evidence,
    }),
  );
  const out = {
    rule,
    to,
    idea: idea.number,
    requestId,
    commented,
    recorded: !same,
  };
  deps.stdout(
    context.json
      ? `${JSON.stringify(out)}\n`
      : `${same && !commented ? "Already requested" : "Requested"}: ${rule} to ${to} on ${link}\n`,
  );
  return 0;
}

export const guardrailRequest: Command = {
  summary:
    "ask a person to approve a guardrail mode change on the idea's issue, with outcome evidence (--rule <rule> --to <enforce|audit|remove> --idea <number or slug> [--dir <transcripts>] [--since YYYY-MM-DD] [--repo <owner/name> --target <ruleset> [--time-period hour|day|week|month]] [--ledger <path>]); changes no guardrail",
  options: {
    rule: "string",
    to: "string",
    idea: "string",
    dir: "string",
    since: "string",
    repo: "string",
    target: "string",
    "time-period": "string",
    ledger: "string",
  },
  async run(context) {
    try {
      return await request(context);
    } catch (error) {
      if (!(
        error instanceof GuardrailError ||
        error instanceof IdeaError ||
        error instanceof RulesetError ||
        error instanceof CommandError
      )) {
        throw error;
      }
      const prefix = context.json
        ? `${JSON.stringify({ error: error.message })}\n`
        : "";
      context.deps.stderr(`${prefix}${error.message}\n`);
      return FAILED;
    }
  },
};

/** The guardrail domain: the inventory commands, plus the request for a person to approve a change. */
export const guardrailDomain: Record<string, Command> = {
  ...guardrailCommands,
  request: guardrailRequest,
};
