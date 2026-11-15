// `guardrail activate`: changes a guardrail's mode, or removes it, only when a person has
// approved the change on the idea's issue. The approver is the owner login of the harness
// config, never a flag, and a label never counts.
// Plan: infra/plans/12-self-improving-loop.md (Step 4).
import {
  GuardrailActivate,
  GuardrailError,
  INVENTORY_PATH,
  denyList,
  parseInventory,
  settingsWithDeny,
  type ActivatePorts,
  type IssueComment,
} from "../guardrail/index.js";
import { IdeaError, IdeaRepository } from "../idea/index.js";
import type { Ledger } from "../ledger/index.js";
import { JudgeError } from "../judge/index.js";
import type { Command, CommandContext } from "../runtime/index.js";
import { repoOf } from "./judge-shared.js";
import { openLedger } from "./ledger-commands.js";
import { ownerLogin } from "./poll-helpers.js";

const FAILED = 1;
const USAGE = 2;
const SETTINGS_PATH = ".claude/settings.json";

const FORM =
  "harness guardrail activate <rule> --to enforce|audit|removed --idea <number> [--ledger]";

function flag(options: CommandContext["options"], key: string) {
  const value = options[key];
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

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

interface View {
  comments?: {
    body?: string;
    createdAt?: string;
    author?: { login?: string };
  }[];
  labels?: { name?: string }[];
}

/** Comments, labels and the refusal comment go through gh on the repository this bundle was built in. */
function ghPorts({ deps }: CommandContext, root: string, repo: string) {
  const view = async (issue: string): Promise<View> => {
    const done = await deps.runner.run(
      "gh",
      ["issue", "view", issue, "--repo", repo, "--json", "comments,labels"],
      { cwd: root },
    );
    if (done.code !== 0) {
      throw ghFailure("view", issue, done.stderr);
    }
    return JSON.parse(done.stdout) as View;
  };
  return {
    async comments(issue: string): Promise<IssueComment[]> {
      return ((await view(issue)).comments ?? []).map((c) => ({
        body: c.body ?? "",
        createdAt: c.createdAt ?? "",
        author: c.author?.login ?? "",
      }));
    },
    async labels(issue: string): Promise<string[]> {
      return ((await view(issue)).labels ?? []).map((l) => l.name ?? "");
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

/** The inventory and settings files, and the ledger event, that an activation writes. */
function filePorts(
  { deps }: CommandContext,
  root: string,
  ledger: Ledger,
): Pick<ActivatePorts, "writeInventory" | "syncDeny" | "recordEvent"> {
  return {
    writeInventory: (text) =>
      deps.fs.writeFile(`${root}/${INVENTORY_PATH}`, text),
    syncDeny: async (inventory) => {
      const path = `${root}/${SETTINGS_PATH}`;
      await deps.fs.writeFile(
        path,
        settingsWithDeny(await deps.fs.readFile(path), denyList(inventory)),
      );
    },
    recordEvent: async (label, idea) => {
      const written = await ledger.record({
        source: "claude",
        kind: "guardrail.activated",
        occurredAt: deps.clock.now().toISOString(),
        idea,
        label,
      });
      return written.ok
        ? { ok: true }
        : { ok: false, message: written.message };
    },
  };
}

async function activateMode(context: CommandContext): Promise<number> {
  const { deps, json, options, operand } = context;
  const missing = [
    operand === undefined ? "<rule>" : undefined,
    ...["to", "idea"].map((key) =>
      flag(options, key) === undefined ? `--${key}` : undefined,
    ),
  ].filter((name) => name !== undefined);
  if (missing.length > 0) {
    return fail(
      context,
      `Missing ${missing.join(", ")}; run \`${FORM}\`.`,
      USAGE,
    );
  }
  const root = await deps.root();
  const opened = await openLedger(context);
  if ("error" in opened) {
    return fail(context, opened.error, FAILED);
  }
  const { ledger } = opened;
  const repo = await repoOf(context);
  const owner = await ownerLogin(context, repo);
  if (typeof owner !== "string") {
    return fail(context, owner.error, FAILED);
  }
  const inventoryText = await deps.fs.readFile(`${root}/${INVENTORY_PATH}`);
  const ports: ActivatePorts = {
    inventory: parseInventory(inventoryText),
    inventoryText,
    idea: await new IdeaRepository(deps.fs, deps.clock, root).get(
      flag(options, "idea") ?? "",
    ),
    approvers: [owner],
    events: async () =>
      (await ledger.list({ kind: "guardrail.requested" })).events,
    ...filePorts(context, root, ledger),
    ...ghPorts(context, root, repo),
  };
  const done = await new GuardrailActivate(ports).activate({
    rule: operand ?? "",
    to: flag(options, "to") ?? "",
  });
  if (json) {
    deps.stdout(`${JSON.stringify(done)}\n`);
  }
  if (!done.activated) {
    deps.stderr(`${done.reason ?? "Refused."} The mode is unchanged.\n`);
    return FAILED;
  }
  if (!json) {
    deps.stdout(
      `${done.rule} is now ${done.to === "removed" ? "removed" : `in ${done.to} mode`}, on a person's approval (idea ${done.idea}).\n`,
    );
  }
  return 0;
}

export const activate: Command = {
  summary:
    "change a guardrail's mode, or remove it, only when a person has approved that change on the idea's issue: a comment from the owner login (ownerLogin in .claude/harness.json, else the repository's owner) made after the request comment, with the line `approve <rule>:<from>><to>`; an agent-applied label never counts; enforcing, loosening and removing need the same approval, requested first with `guardrail request`; on approval it edits .claude/guardrails.yaml (and regenerates the settings deny list for a deny rule) and records a guardrail.activated ledger event; with no request, no approval or only a label it refuses (exit 1), leaves the mode as it is and posts one refusal comment on the idea's issue (<rule> --to enforce|audit|removed --idea <number> [--json: rule, from, to, idea, issue, activated, reason, refusalPosted, commentUrl] [--ledger])",
  operand: "rule",
  options: { to: "string", idea: "string", ledger: "string" },
  async run(context) {
    try {
      return await activateMode(context);
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
