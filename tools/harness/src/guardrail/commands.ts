import { openSharedLedger } from "../ledger/index.js";
import type { Command, CommandContext } from "../runtime/index.js";
import {
  denyDrift,
  denyList,
  settingsDeny as currentDeny,
  settingsWithDeny,
} from "./deny.js";
import { GuardrailError, INVENTORY_PATH, type Inventory } from "./inventory.js";
import { readInventory } from "./read.js";
import { waitingRequests } from "./pending.js";
import type { Pending } from "./requests.js";

const SETTINGS_PATH = ".claude/settings.json";

const NO_LEDGER =
  "No shared ledger could be found, so requests waiting for approval are not shown. Run inside the repository, set KORE_ROOT to its root, or pass --ledger <path>.";

/** The requests waiting for a person's approval; none, with the reason on stderr, when the ledger cannot be opened. */
async function waiting(
  context: CommandContext,
  inventory: Inventory,
): Promise<Map<string, Pending>> {
  const { deps, options } = context;
  const ledger = await openSharedLedger(
    deps,
    typeof options["ledger"] === "string" ? options["ledger"] : undefined,
  );
  if (ledger === undefined) {
    deps.stderr(`${NO_LEDGER}\n`);
    return new Map();
  }
  return await waitingRequests(deps, inventory, ledger);
}

const status: Command = {
  summary:
    "list each guardrail with its kind, mode and owner, and the request waiting for a person's approval, if any",
  options: { ledger: "string" },
  async run(context) {
    const { json, deps } = context;
    try {
      const inventory = await readInventory(
        (path) => deps.fs.readFile(path),
        await deps.root(),
      );
      const pending = await waiting(context, inventory);
      const guardrails = inventory.guardrails.map((g) => {
        const request = pending.get(g.rule);
        return request === undefined ? g : { ...g, pending: request };
      });
      if (json) {
        deps.stdout(`${JSON.stringify({ guardrails })}\n`);
      } else {
        for (const g of guardrails) {
          const request =
            "pending" in g
              ? `\tpending: ${g.pending.to} (idea ${g.pending.idea})`
              : "";
          deps.stdout(
            `${g.rule}\t${g.kind}\t${g.mode}\t${g.owner}${request}\n`,
          );
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

const deny: Command = {
  summary:
    "print the settings deny list generated from the enforced deny rules; --check fails when settings differ, --write regenerates them",
  options: {
    check: "boolean",
    write: "boolean",
    "allow-removal": "boolean",
  },
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
