import type { Command, CommandContext, CommandHelp } from "../runtime/index.js";
import {
  denyDrift,
  denyList,
  settingsDeny as currentDeny,
  settingsWithDeny,
} from "./deny.js";
import { GuardrailError, INVENTORY_PATH, type Inventory } from "./inventory.js";
import type { PendingRequest } from "./pending.js";
import { readInventory } from "./read.js";

const SETTINGS_PATH = ".claude/settings.json";

/** Finds the approval requests still waiting; the caller owns where they are recorded. */
export type LoadPending = (
  context: CommandContext,
  inventory: Inventory,
) => Promise<PendingRequest[]>;

/** The help record for `guardrail status`: the guardrails, and the requests waiting for approval. */
const statusHelp: CommandHelp = {
  purpose:
    "Lists each guardrail with its kind, mode and owner, and the requests still waiting for a person's approval, read from the ledger. It reads the inventory and the ledger and changes nothing.",
  when: "When you need the current mode of each guardrail, or which mode changes are waiting for approval before you request or activate one.",
  whenNot:
    "When you need a rule's firings over past calls: use guardrail replay, which judges a rule change over the transcripts. To read the settings deny list, use guardrail deny.",
  flags: {
    ledger:
      "The ledger file the pending requests are read from, relative to the working directory; by default the shared ledger of the main checkout.",
  },
  examples: [
    {
      command: "harness guardrail status",
      shows:
        "one line per guardrail: its rule, kind, mode and owner, with pending and the proposed mode when a request is waiting",
    },
    {
      command: "harness guardrail status --json",
      shows:
        "the guardrails and the pending requests (rule, from, to, idea) as one JSON object",
    },
  ],
  exits: [
    {
      code: 0,
      meaning:
        "the guardrails are listed; a ledger that cannot be opened lists no pending requests and says why on stderr",
    },
    {
      code: 1,
      meaning:
        "the inventory .claude/guardrails.yaml is missing or invalid; stderr names the fix",
    },
    {
      code: 2,
      meaning: "a flag the command does not declare, or a flag with no value",
    },
  ],
  effects: {
    kind: "read-only",
    detail:
      "reads .claude/guardrails.yaml and the guardrail.requested events in the ledger; writes nothing",
  },
  seeAlso: ["guardrail request", "guardrail activate", "guardrail replay"],
};

/** The `status` command over a source of pending requests. */
export function statusWith(loadPending: LoadPending): Command {
  return {
    summary:
      "list each guardrail's mode, and the mode changes awaiting a person's approval",
    options: { ledger: "string" },
    help: statusHelp,
    async run(context) {
      const { json, deps } = context;
      try {
        const inventory = await readInventory(
          (path) => deps.fs.readFile(path),
          await deps.root(),
        );
        const { guardrails } = inventory;
        const pending = await loadPending(context, inventory);
        if (json) {
          deps.stdout(`${JSON.stringify({ guardrails, pending })}\n`);
        } else {
          for (const g of guardrails) {
            const waiting = pending.find((p) => p.rule === g.rule);
            const mark =
              waiting === undefined
                ? ""
                : `\tpending: ${waiting.to} (idea ${waiting.idea})`;
            deps.stdout(`${g.rule}\t${g.kind}\t${g.mode}\t${g.owner}${mark}\n`);
          }
        }
        return 0;
      } catch (error) {
        if (!(error instanceof GuardrailError)) {
          throw error;
        }
        deps.stderr(
          `${json ? `${JSON.stringify({ error: error.message })}\n` : ""}${error.message}\n`,
        );
        return 1;
      }
    },
  };
}

const status = statusWith(() => Promise.resolve([]));

/** Regenerates the settings deny list; a pattern that would leave it needs --allow-removal. */
async function writeDeny(
  deps: CommandContext["deps"],
  path: string,
  list: string[],
  allowRemoval: boolean,
): Promise<void> {
  const current = await deps.fs.readFile(path);
  const leaving = currentDeny(current).filter((p) => !list.includes(p));
  if (leaving.length > 0) {
    deps.stderr(
      `${SETTINGS_PATH}: these patterns would leave the deny list: ${leaving.join(", ")}.\n`,
    );
    if (!allowRemoval) {
      throw new GuardrailError(
        "Removing a deny rule weakens the guard. Instead, restore the rule in the inventory, " +
          "or rerun with --allow-removal once the user has approved it.",
      );
    }
  }
  await deps.fs.writeFile(path, settingsWithDeny(current, list));
}

/** The help record for `guardrail deny`: the settings deny list the inventory generates. */
const denyHelp: CommandHelp = {
  purpose:
    "Prints the settings deny list that the enforced deny rules in the inventory generate. With --check it fails when .claude/settings.json differs from that list; with --write it regenerates the list in the settings. The inventory owns the list, so a hand edit of the settings is drift.",
  when: "When a deny rule in .claude/guardrails.yaml has changed and the settings must follow it, or in a check that the settings still match the inventory.",
  whenNot:
    "When you want something denied or allowed again: edit the deny rule in the inventory, then write the list; never edit .claude/settings.json by hand. When you want a rule's mode changed: use guardrail request.",
  flags: {
    check:
      "Fails when .claude/settings.json differs from the list the inventory generates, and names the drift; it prints nothing and changes nothing when they match.",
    write:
      "Regenerates the deny list in .claude/settings.json from the inventory, then prints the list it wrote.",
    "allow-removal":
      "Lets --write drop a pattern the settings held that the inventory no longer lists. Without it such a write is refused, because removing a pattern weakens the guard; use it only after the owner approves the removal.",
  },
  examples: [
    {
      command: "harness guardrail deny",
      shows:
        "the patterns of every enforced deny rule, one per line in inventory order; nothing is written",
    },
    {
      command: "harness guardrail deny --check",
      shows:
        "nothing and exit 0 when the settings match the inventory; otherwise the drift, and exit 1",
    },
    {
      command: "harness guardrail deny --write",
      shows:
        "the settings rewritten from the inventory, then the list that was written",
    },
  ],
  exits: [
    {
      code: 0,
      meaning:
        "the list is printed; with --check the settings match; with --write the settings were regenerated",
    },
    {
      code: 1,
      meaning:
        "--check and --write were given together, the settings drift under --check, --write would drop a pattern without --allow-removal, the inventory is invalid, or .claude/settings.json is missing; stderr names the fix, and --json adds the problems as one object",
    },
    {
      code: 2,
      meaning: "a flag the command does not declare, or a flag with no value",
    },
  ],
  effects: {
    kind: "mutates",
    detail:
      "read-only with no flag and with --check; --write rewrites the deny list in .claude/settings.json and changes nothing else",
  },
  seeAlso: ["guardrail activate", "guardrail status"],
};

const deny: Command = {
  summary:
    "print, check or regenerate the settings deny list the inventory generates",
  options: {
    check: "boolean",
    write: "boolean",
    "allow-removal": "boolean",
  },
  help: denyHelp,
  async run({ json, options, deps }) {
    const report = (problems: string[], message: string): number => {
      deps.stdout(json ? `${JSON.stringify({ problems })}\n` : "");
      deps.stderr(`${message}\n`);
      return 1;
    };
    try {
      if (options["check"] === true && options["write"] === true) {
        throw new GuardrailError(
          "--check and --write cannot be used together. Instead, run one, then the other.",
        );
      }
      const root = await deps.root();
      const inventory = await readInventory((p) => deps.fs.readFile(p), root);
      const list = denyList(inventory);
      const path = `${root}/${SETTINGS_PATH}`;
      if (options["write"] === true) {
        await writeDeny(deps, path, list, options["allow-removal"] === true);
      } else if (options["check"] === true) {
        const problems = denyDrift(inventory, await deps.fs.readFile(path));
        return problems.length === 0
          ? 0
          : report(
              problems,
              `${SETTINGS_PATH}: ${problems.join("; ")}. The inventory owns the deny list. ` +
                `Instead of editing settings, change ${INVENTORY_PATH}, then run \`guardrail deny --write\`.`,
            );
      }
      deps.stdout(
        json
          ? `${JSON.stringify({ deny: list })}\n`
          : list.map((p) => `${p}\n`).join(""),
      );
      return 0;
    } catch (error) {
      if (error instanceof GuardrailError) {
        return report([error.message], error.message);
      }
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        const message = `${SETTINGS_PATH} is missing. Restore it from git, then rerun.`;
        return report([message], message);
      }
      throw error;
    }
  },
};

export const guardrailCommands: Record<string, Command> = { status, deny };
