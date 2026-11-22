// `guardrail request` and the ledger-backed `guardrail status`: the guardrail
// tool's two commands that need the ledger, the idea records and gh. The request
// asks a person to approve a mode change; it never changes one.
// Plan: infra/plans/12-self-improving-loop.md (Step 4).
import { resolve } from "node:path";
import {
  GuardrailError,
  GuardrailRequest,
  guardrailCommands,
  pendingRequests,
  readInventory,
  statusWith,
  type Inventory,
  type PendingRequest,
  type RequestPorts,
} from "../guardrail/index.js";
import { IdeaError, IdeaRepository } from "../idea/index.js";
import { JudgeError } from "../judge/index.js";
import type { Command, CommandContext, CommandHelp } from "../runtime/index.js";
import { activate } from "./guardrail-activate-commands.js";
import { repoOf } from "./judge-shared.js";
import { openLedger } from "./ledger-commands.js";

const FAILED = 1;
const USAGE = 2;
const KIND = "guardrail.requested";

/** The `harness guardrail request` form, quoted in every usage error. */
const FORM =
  "harness guardrail request <rule> --to enforce|audit|removed --idea <number> --scan <retro-scan.json> --false-positives <n> [--ledger]";

function flag(options: CommandContext["options"], key: string) {
  const value = options[key];
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

/** Prints an expected failure as the command's message, plus a JSON object first under --json. */
function fail({ json, deps }: CommandContext, message: string, code: number) {
  deps.stderr(
    `${json ? `${JSON.stringify({ error: message })}\n` : ""}${message}\n`,
  );
  return code;
}

function ghFailure(
  verb: string,
  issue: string,
  stderr: string,
): GuardrailError {
  return new GuardrailError(
    `gh issue ${verb} failed for issue #${issue}: ${stderr.trim()}. Check \`gh auth status\` and the issue number, then rerun the same command.`,
  );
}

/** Comments and events go through gh and the ledger on the repository this bundle was built in. */
function ghPorts({ deps }: CommandContext, root: string, repo: string) {
  return {
    async comments(issue: string): Promise<string[]> {
      const done = await deps.runner.run(
        "gh",
        ["issue", "view", issue, "--repo", repo, "--json", "comments"],
        { cwd: root },
      );
      if (done.code !== 0) {
        throw ghFailure("view", issue, done.stderr);
      }
      const parsed = JSON.parse(done.stdout) as {
        comments?: { body?: string }[];
      };
      return (parsed.comments ?? []).map((c) => c.body ?? "");
    },
    async comment(issue: string, body: string): Promise<string> {
      const done = await deps.runner.run(
        "gh",
        ["issue", "comment", issue, "--repo", repo, "--body", body],
        { cwd: root },
      );
      if (done.code !== 0) {
        throw ghFailure("comment", issue, done.stderr);
      }
      return done.stdout.trim();
    },
  };
}

async function readScan(context: CommandContext, path: string) {
  const text = await context.deps.fs.readFile(resolve(context.deps.cwd, path));
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new GuardrailError(
      `${path} is not JSON. Pass the output of \`harness hook retro-scan --strict\`.`,
    );
  }
}

function usage(context: CommandContext) {
  const { options, operand } = context;
  const missing = [
    operand === undefined ? "<rule>" : undefined,
    ...["to", "idea", "scan", "false-positives"].map((key) =>
      flag(options, key) === undefined ? `--${key}` : undefined,
    ),
  ].filter((name) => name !== undefined);
  return missing.length === 0
    ? undefined
    : `Missing ${missing.join(", ")}; run \`${FORM}\`.`;
}

async function requestMode(context: CommandContext): Promise<number> {
  const { deps, json, options } = context;
  const problem = usage(context);
  if (problem !== undefined) {
    return fail(context, problem, USAGE);
  }
  const falsePositives = Number(flag(options, "false-positives"));
  if (!Number.isSafeInteger(falsePositives) || falsePositives < 0) {
    return fail(
      context,
      "--false-positives must be a whole number of zero or more: how many of the rule's warnings or blocks the retro judged to hit legitimate work.",
      USAGE,
    );
  }
  const root = await deps.root();
  const opened = await openLedger(context);
  if ("error" in opened) {
    return fail(context, opened.error, FAILED);
  }
  const { ledger } = opened;
  const scan = await readScan(context, flag(options, "scan") ?? "");
  const repo = await repoOf(context);
  const ports: RequestPorts = {
    env: deps.env,
    inventory: await readInventory((p) => deps.fs.readFile(p), root),
    idea: await new IdeaRepository(deps.fs, deps.clock, root).get(
      flag(options, "idea") ?? "",
    ),
    repo,
    events: async () => (await ledger.list({ kind: KIND })).events,
    recordEvent: async (label, idea) => {
      const written = await ledger.record({
        source: "claude",
        kind: KIND,
        occurredAt: deps.clock.now().toISOString(),
        idea,
        label,
      });
      return written.ok
        ? { ok: true }
        : { ok: false, message: written.message };
    },
    ...ghPorts(context, root, repo),
  };
  const done = await new GuardrailRequest(ports).request({
    rule: context.operand ?? "",
    to: flag(options, "to") ?? "",
    falsePositives,
    scan,
  });
  const wording =
    done.posted || done.recorded
      ? `Requested approval to ${done.to === "removed" ? "remove" : done.to} ${done.rule} on the issue of idea ${done.idea}; the mode is unchanged.`
      : `Already requested: ${done.rule} is waiting on the issue of idea ${done.idea}; nothing was posted.`;
  deps.stdout(json ? `${JSON.stringify(done)}\n` : `${wording}\n`);
  return 0;
}

/** The help record for `guardrail request`: asks a person to approve a mode change, and changes none. */
const requestHelp: CommandHelp = {
  purpose:
    "Asks a person to approve changing a guardrail's mode: posts one comment on the idea's issue with the idea link and four figures from a retro-scan report (fired, heeded, overridden and false positives), and records a guardrail.requested ledger event. It never changes a mode; guardrail activate applies the change after the approval. --json gives rule, from, to, idea, issue, evidence, posted, recorded and commentUrl.",
  when: "When a guardrail should move between audit and enforce, or be removed, and the idea has an issue to ask on; run it with the retro-scan report of the rule's warnings and blocks. Tightening, loosening and removal are requested the same way.",
  whenNot:
    "When you only want to see the modes or the waiting requests: use guardrail status. When the owner has already approved the change on the issue: run guardrail activate. A rerun of a request already posted posts nothing, so there is no need to repeat it.",
  flags: {
    to: "The mode the rule moves to: enforce (tighten), audit (loosen) or removed. It must differ from the rule's current mode.",
    idea: "The number of the idea whose issue carries the request; the idea must have an issue.",
    scan: "The retro-scan report, as JSON, from harness hook retro-scan --strict, read relative to the working directory.",
    "false-positives":
      "How many of the rule's warnings or blocks the retro judged to hit legitimate work: a whole number, zero or more.",
    ledger:
      "The ledger file the request is recorded in, relative to the working directory; by default the shared ledger of the main checkout.",
  },
  operand:
    "The guardrail rule to change, as named in .claude/guardrails.yaml, such as flag-activation.",
  examples: [
    {
      command:
        "harness guardrail request flag-activation --to enforce --idea 1500 --scan retro-scan.json --false-positives 0",
      shows:
        "the request posted on idea 1500's issue and recorded; the mode stays audit until the owner approves",
    },
    {
      command:
        "harness guardrail request flag-activation --to enforce --idea 1500 --scan retro-scan.json",
      shows:
        "--false-positives is missing, so the usage line prints and the command exits 2 without posting",
    },
  ],
  exits: [
    {
      code: 0,
      meaning:
        "the request is posted and recorded, or it was already requested and nothing was posted",
    },
    {
      code: 1,
      meaning:
        "refused with nothing posted: no such rule, an unknown --to, the rule already in that mode, an idea with no issue, a scan that is not JSON or lacks the evidence, or a gh call failed; also when the ledger event is rejected after the comment was posted, and a rerun then records it without posting again",
    },
    {
      code: 2,
      meaning:
        "the rule, --to, --idea, --scan or --false-positives is missing, --false-positives is not a whole number, or a flag the command does not declare",
    },
  ],
  effects: {
    kind: "mutates",
    detail:
      "posts one comment on the idea's issue through gh and appends one guardrail.requested event to the ledger; it changes no mode, no inventory file and no settings",
  },
  seeAlso: ["guardrail status", "guardrail activate", "hook retro-scan"],
};

const request: Command = {
  help: requestHelp,
  summary:
    "ask a person to approve a guardrail's mode change on its idea's issue; changes no mode",
  operand: "rule",
  options: {
    to: "string",
    idea: "string",
    scan: "string",
    "false-positives": "string",
    ledger: "string",
  },
  async run(context) {
    try {
      return await requestMode(context);
    } catch (error) {
      if (
        error instanceof GuardrailError ||
        error instanceof IdeaError ||
        error instanceof JudgeError
      ) {
        return fail(context, error.message, FAILED);
      }
      throw error;
    }
  },
};

/** The requests still waiting for a person, from the ledger; an unreachable ledger shows none and says why. */
export async function loadPending(
  context: CommandContext,
  inventory: Inventory,
): Promise<PendingRequest[]> {
  const opened = await openLedger(context);
  if ("error" in opened) {
    context.deps.stderr(`Pending requests are not shown: ${opened.error}\n`);
    return [];
  }
  const { events } = await opened.ledger.list({ kind: KIND });
  return pendingRequests(events, inventory);
}

/** The guardrail commands that need the ledger, the idea records or gh. */
export const guardrailLedgerCommands: Record<string, Command> = {
  ...guardrailCommands,
  status: statusWith(loadPending),
  request,
  activate,
};
