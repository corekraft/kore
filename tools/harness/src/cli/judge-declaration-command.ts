import { auditDeclaration } from "../judge/index.js";
import type { Command } from "../runtime/index.js";

const declaration: Command = {
  summary:
    "read-only; audit a PR body read from stdin: exactly one valid `Safety pattern: <pattern>` line, and it is the last line; exits 1 and names the fix when it is not (the CI audit job pipes the body in)",
  run: async ({ deps }) => {
    const result = auditDeclaration(await deps.stdin());
    if (result.ok) {
      deps.stdout("PR body declaration: ok\n");
      return 0;
    }
    deps.stderr(`PR body declaration: ${result.reason}\n`);
    return 1;
  },
};

export const declarationCommands: Record<string, Command> = { declaration };
