// `harness guardrail request`: asks a person to approve a guardrail mode
// change, on the idea's issue, with the idea's outcome evidence (ADR 0080).
// It only comments and records a ledger event; it never changes a mode.
// Plan: infra/plans/12-self-improving-loop.md (Step 4).
import {
  GuardrailError,
  guardrailCommands,
  isTarget,
  readInventory,
  renderRequest,
  requestLabel,
  marker,
  pendingRequests,
  REQUEST_KIND,
  TARGETS,
  type Guardrail,
  type Inventory,
  type Target,
} from "../guardrail/index.js";
import { ruleEvidence } from "../hook/index.js";
import { IdeaError, IdeaRepository, issueTarget } from "../idea/index.js";
import {
  CommandError,
  type Command,
  type CommandContext,
} from "../runtime/index.js";
import type { Ledger } from "../ledger/index.js";
import { openLedger } from "./ledger-commands.js";

const FAILED = 1;

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
      `--to must be ${TARGETS.slice(0, -1).join(", ")} or ${TARGETS.at(-1)}; got "${to}". Instead, pass one of them.`,
    );
  }
  return to;
}

async function commentedAlready(
  { deps }: CommandContext,
  issue: { number: string; repo: string },
  wanted: string,
): Promise<boolean> {
  const view = await deps.runner.run(
    "gh",
    ["issue", "view", issue.number, "--repo", issue.repo, "--json", "comments"],
    { cwd: await deps.root() },
  );
  if (view.code !== 0) {
    throw new GuardrailError(
      `gh issue view failed for issue ${issue.number}: ${view.stderr.trim()}. Check \`gh auth status\`, then rerun \`harness guardrail request\`.`,
    );
  }
  let comments: { body?: string }[] = [];
  try {
    comments =
      (JSON.parse(view.stdout) as { comments?: { body?: string }[] })
        .comments ?? [];
  } catch {
    throw new GuardrailError(
      `gh returned unreadable output for issue ${issue.number}. Check \`gh auth status\`, then rerun \`harness guardrail request\`.`,
    );
  }
  return comments.some((c) => c.body?.includes(wanted) === true);
}

/** Posts the comment unless the issue already holds this request; true when it posted. */
async function post(
  context: CommandContext,
  issue: { number: string; repo: string },
  wanted: string,
  body: string,
): Promise<boolean> {
  const { deps } = context;
  if (await commentedAlready(context, issue, wanted)) {
    return false;
  }
  const posted = await deps.runner.run(
    "gh",
    [
      "issue",
      "comment",
      issue.number,
      "--repo",
      issue.repo,
      "--body-file",
      "-",
    ],
    { cwd: await deps.root(), input: body },
  );
  if (posted.code !== 0) {
    throw new GuardrailError(
      `gh issue comment failed for issue ${issue.number}: ${posted.stderr.trim()}. Check \`gh auth status\`, then rerun \`harness guardrail request\`.`,
    );
  }
  return true;
}

/** Records the request in the ledger. */
async function log(
  { deps }: CommandContext,
  ledger: Ledger,
  idea: string,
  label: string,
): Promise<void> {
  const event = await ledger.record({
    source: "claude",
    kind: REQUEST_KIND,
    occurredAt: deps.clock.now().toISOString(),
    idea,
    label,
  });
  if (!event.ok) {
    throw new GuardrailError(
      `The request was posted, but its ledger event was rejected: ${event.message} Fix the ledger, then rerun \`harness guardrail request\` to record it.`,
    );
  }
}

/** The rule to change, or the fix for a rule that is unknown or already in the requested state. */
function changeable(inventory: Inventory, rule: string, to: Target): Guardrail {
  const guardrail = inventory.guardrails.find((g) => g.rule === rule);
  if (guardrail === undefined) {
    throw new GuardrailError(
      `${rule} is not in .claude/guardrails.yaml. Instead, pick one of: ${inventory.guardrails.map((g) => g.rule).join(", ")}.`,
    );
  }
  if (guardrail.mode === to) {
    throw new GuardrailError(
      `${rule} is already in ${to} mode, so there is nothing to approve. Instead, request a different state.`,
    );
  }
  return guardrail;
}

async function request(context: CommandContext): Promise<number> {
  const { deps } = context;
  const rule = required(context, "rule");
  const to = target(required(context, "to"));
  const ideaRef = required(context, "idea");
  const root = await deps.root();
  const inventory = await readInventory((p) => deps.fs.readFile(p), root);
  const guardrail = changeable(inventory, rule, to);
  const opened = await openLedger(context);
  if ("error" in opened) {
    throw new GuardrailError(opened.error);
  }
  const record = await new IdeaRepository(deps.fs, deps.clock, root).get(
    ideaRef,
  );
  const issue = await issueTarget(deps.runner, root, record);
  const asked = await priorRequests(opened.ledger, inventory, {
    rule,
    to,
    idea: record.number,
  });
  const link = `https://github.com/${issue.repo}/issues/${issue.number}`;
  if (asked.pending) {
    return finish(
      context,
      { rule, to, idea: record.number, link },
      false,
      false,
    );
  }
  const evidence = await ruleEvidence(deps, rule, {
    dir: text(context.options, "dir"),
    since: text(context.options, "since"),
  });
  const body = renderRequest({
    guardrail,
    to,
    idea: {
      number: record.number,
      title: record.title,
      path: record.path,
      link,
    },
    evidence,
  });
  const commented = await post(context, issue, marker(rule, to), body);
  await log(context, opened.ledger, record.number, requestLabel(rule, to));
  return finish(
    context,
    { rule, to, idea: record.number, link },
    commented,
    true,
  );
}

/** Whether this very request already waits for a person: it stays pending until the inventory holds its target. */
async function priorRequests(
  ledger: Ledger,
  inventory: Inventory,
  { rule, to, idea }: { rule: string; to: Target; idea: string },
): Promise<{ pending: boolean }> {
  const { events } = await ledger.list({ kind: REQUEST_KIND });
  const waiting = pendingRequests(inventory, events).get(rule);
  return { pending: waiting?.to === to && waiting.idea === idea };
}

function finish(
  { deps, json }: CommandContext,
  done: { rule: string; to: Target; idea: string; link: string },
  commented: boolean,
  recorded: boolean,
): number {
  deps.stdout(
    json
      ? `${JSON.stringify({ rule: done.rule, to: done.to, idea: done.idea, commented, recorded })}\n`
      : `${recorded ? "Requested" : "Already requested"}: ${done.rule} to ${done.to} on ${done.link}\n`,
  );
  return 0;
}

export const guardrailRequest: Command = {
  summary:
    "ask a person to approve a guardrail mode change on the idea's issue, with outcome evidence (--rule <rule> --to <enforce|audit|remove> --idea <number or slug> [--dir <transcripts>] [--since YYYY-MM-DD] [--ledger <path>]); changes no guardrail",
  options: {
    rule: "string",
    to: "string",
    idea: "string",
    dir: "string",
    since: "string",
    ledger: "string",
  },
  async run(context) {
    try {
      return await request(context);
    } catch (error) {
      if (!(
        error instanceof GuardrailError ||
        error instanceof IdeaError ||
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
