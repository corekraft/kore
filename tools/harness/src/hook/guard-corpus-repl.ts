// The REPL cases (plan 16, Step 4 (0), #1872). A spawned role runs with Code Mode off, so it has no REPL; a
// read-only role that runs one anyway is refused, since the guard cannot read its JavaScript. A reader's session
// report heredoc is data in Bash and stays allowed, and a write after that heredoc stays refused.
import type { CorpusCase, OrdinaryCase } from "./guard-corpus.js";

const READ_ONLY = ["reader", "principles-review", "judgment"];

const REPORT =
  "node skills/bin/harness.mjs session report --outcome done --summary - <<'EOF'";

/** REPL calls a read-only role may not run: a shell write, a file write in JavaScript, and a shell read. */
export const REPL_REFUSED: readonly CorpusCase[] = READ_ONLY.flatMap((role) =>
  [
    "await $`echo x > out.txt`",
    "await $`rm -rf src`",
    "require('fs').writeFileSync('out.txt', 'x')",
    "await $`cat docs/index.md`",
  ].map((input): CorpusCase => ({
    role,
    tool: "REPL",
    input,
    rule: "role-read-only",
  })),
);

/** A write after a session report heredoc is still a write in Bash, refused for a read-only role. */
export const REPORT_WRITE_REFUSED: readonly CorpusCase[] = READ_ONLY.map(
  (role): CorpusCase => ({
    role,
    tool: "Bash",
    input: `${REPORT}\nx\nEOF\ntee out.txt`,
    rule: "role-read-only",
  }),
);

/** A reader's session report with a quoted heredoc is data, not shell, so it stays allowed in Bash. */
export const REPORT_ORDINARY: readonly OrdinaryCase[] = READ_ONLY.map(
  (role): OrdinaryCase => ({
    role,
    tool: "Bash",
    input: `${REPORT}\nThe verdict cites \`src/a.ts:3\` and $(not run)\nEOF`,
  }),
);
