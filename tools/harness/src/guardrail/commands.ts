import type { Command } from "../runtime/index.js";
import { GuardrailError } from "./inventory.js";
import { readInventory } from "./read.js";

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

export const guardrailCommands: Record<string, Command> = { status };
