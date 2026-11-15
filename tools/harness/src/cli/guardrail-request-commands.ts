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
import type { Command, CommandContext } from "../runtime/index.js";
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

const request: Command = {
  summary:
    "ask a person to approve changing a guardrail's mode: posts one comment on the idea's issue with the idea link and four figures (fired, heeded, overridden, false positives, read from a retro-scan report; --false-positives is the retro's count of warnings or blocks that hit legitimate work), and records a guardrail.requested ledger event; tightening (audit to enforce), loosening (enforce to audit) and removal are requested the same way; the comment is posted once per change, a rerun posts nothing; a request never changes a mode, and is refused with nothing posted when the evidence is missing or the idea has no issue (<rule> --to enforce|audit|removed --idea <number> --scan <retro-scan.json> --false-positives <n> [--json: rule, from, to, idea, issue, evidence, posted, recorded, commentUrl] [--ledger])",
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
};
