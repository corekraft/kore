// The zsh glob attempts (#1003): a glob qualifier runs code, so the bounded roles and the writer's shell
// refuse them. guard-corpus.ts runs these through the hook.
import type { CorpusCase } from "./guard-corpus.js";

/** A zsh glob qualifier runs code in `e:'...':`, and `+func` calls a function. */
const GLOB_QUALIFIERS = [undefined, "writer", "reader", "judge"].flatMap(
  (role) =>
    [
      "ls *(e:'touch pwned':)",
      "echo *(.e:'id':)",
      "cat ?(e:'id':)",
      "ls **/*(+evil)",
      "ls *(N.e:'id':)",
      "echo a(e:'touch p':)",
      "echo {a,b}(e:'touch p':)",
    ].map((input): CorpusCase => {
      const base = {
        tool: "Bash" as const,
        input,
        rule: "unquoted-glob",
      };
      return role === undefined ? base : { ...base, role };
    }),
);

/** A shell given the qualifier as a script: only the sessions with a full shell reach it. */
const GLOB_IN_SCRIPT = [undefined, "writer"].flatMap((role) =>
  [`zsh -c "ls *(e:'id':)"`, `bash -c "ls *(+evil)"`].map(
    (input): CorpusCase => {
      const base = { tool: "Bash" as const, input, rule: "unquoted-glob" };
      return role === undefined ? base : { ...base, role };
    },
  ),
);

/** Every zsh glob attempt the guard must refuse as unquoted-glob. */
export const GLOB_CASES: readonly CorpusCase[] = [
  ...GLOB_QUALIFIERS,
  ...GLOB_IN_SCRIPT,
];
