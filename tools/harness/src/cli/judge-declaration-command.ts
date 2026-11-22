import { auditDeclaration } from "../judge/index.js";
import type { Command, CommandHelp } from "../runtime/index.js";

const declarationHelp: CommandHelp = {
  purpose:
    "Audits a PR body read from stdin: it must declare exactly one valid Safety pattern line, naming one of the five patterns, and that line must be the last line of the body. CI's audit job pipes each PR body through it.",
  when: "When a PR body is written or edited, before the PR is opened, to see whether its declaration will pass the precheck.",
  whenNot:
    "When you need the verdict on the whole PR, use judge precheck. This reads only the body it is given, never GitHub.",
  flags: {},
  examples: [
    {
      command: "harness judge declaration",
      shows:
        "PR body declaration: ok when the body on stdin ends with one valid Safety pattern line, else the reason and its fix",
    },
  ],
  exits: [
    { code: 0, meaning: "the body's declaration is valid" },
    {
      code: 1,
      meaning:
        "the declaration is missing, repeated, blank, not a known pattern, or not the last line; stderr names the fix",
    },
    {
      code: 2,
      meaning:
        "a usage error: a flag the command does not declare, or an operand it does not take",
    },
  ],
  effects: {
    kind: "read-only",
    detail: "reads stdin and prints one line; no GitHub call and no write",
  },
  seeAlso: ["judge precheck", "pr open"],
};

const declaration: Command = {
  summary:
    "audit a PR body on stdin for one valid Safety pattern line, as its last line",
  help: declarationHelp,
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
