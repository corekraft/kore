import type { Command } from "../runtime/index.js";
import { denyDrift, denyList, settingsWithDeny } from "./deny.js";
import { GuardrailError, INVENTORY_PATH } from "./inventory.js";
import { readInventory } from "./read.js";

const SETTINGS_PATH = ".claude/settings.json";

const status: Command = {
  summary: "list each guardrail with its kind, mode and owner",
  async run({ json, deps }) {
    try {
      const { guardrails } = await readInventory(
        (path) => deps.fs.readFile(path),
        await deps.root(),
      );
      if (json) {
        deps.stdout(`${JSON.stringify({ guardrails })}\n`);
      } else {
        for (const g of guardrails) {
          deps.stdout(`${g.rule}\t${g.kind}\t${g.mode}\t${g.owner}\n`);
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

const deny: Command = {
  summary:
    "print the settings deny list generated from the enforced deny rules; --check fails when settings differ, --write regenerates them",
  options: { check: "boolean", write: "boolean" },
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
        await deps.fs.writeFile(
          path,
          settingsWithDeny(await deps.fs.readFile(path), list),
        );
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
