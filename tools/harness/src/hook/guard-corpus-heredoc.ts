// Bypass and ordinary cases for the role-worktree path check's text rules (guard-text.ts): a heredoc
// body is text only when the whole command is one cat or tee that writes a file, and a node -e
// string literal is a path while a regex literal is not. Part of the corpus in guard-corpus.ts,
// which the integration spec runs through `hook guard`; the cases live here so guard-corpus.ts
// stays within its size limit.

import type { CorpusCase } from "./guard-corpus.js";

const writer = (input: string): CorpusCase => ({
  role: "writer",
  tool: "Bash",
  input,
  rule: "role-worktree",
});

/** A heredoc that writes a.sh, whose body removes a path outside the worktree, then the text after it. */
const writesThen = (after: string): string =>
  `cat > a.sh <<'EOF'\nrm /elsewhere/b\nEOF\n${after}`;

/** A second command after the heredoc, however it runs what the heredoc wrote. */
const SECOND_COMMANDS = [
  "sh a.sh",
  "sh<a.sh",
  "bash<a.sh",
  "node<a.js",
  "./a.sh",
  "/tmp/a.sh",
  "chmod +x a.sh && a.sh",
  "source a.sh",
  ". a.sh",
  "exec sh a.sh",
  'eval "$(cat a.sh)"',
  "xargs sh <a.sh",
  "cat a.sh | env sh",
  "env sh a.sh",
  "ls",
];

export const HEREDOC = {
  // A heredoc body stays code unless the whole command is one cat or tee that only writes a file
  // (ADR 0080, fail closed): any other command word, however it runs, keeps the body as code. A
  // node -e string literal is a path whatever the regex rules say, so an outside read stays refused.
  corpus: [
    "bash <<'EOF'\ncp a /elsewhere/b\nEOF",
    "cat <<'EOF' | sh\nrm /elsewhere/b\nEOF",
    ...SECOND_COMMANDS.map(writesThen),
    "cat <<EOF \\\n> /elsewhere/b\nx\nEOF",
    'cat > a.md <<E"O"F\nx\nEOF\nrm /elsewhere/b',
    "cat <<EOF > a.md; rm /elsewhere/b\nx\nEOF",
    "cat <<EOF > a.md && rm /elsewhere/b\nx\nEOF",
    "cat <<EOF > >(rm /elsewhere/b)\nx\nEOF",
    "node -e \"require('fs').readFileSync('/elsewhere/kore/a.ts')\"",
    "node -e \"require('fs').readFileSync('../../../secret')\"",
    "node -e \"x=a++ / 2; require('fs').readFileSync('/elsewhere/a'); y=b / 3\"",
    "node -e \"x=a.of / 2; require('fs').readFileSync('/elsewhere/a'); y=b / 3\"",
    'node -e "/$(rm /elsewhere/b)/"',
    "python3 -c \"def f(a, /): pass\nopen('/elsewhere/a').read()\"",
    "python3 -c \"x = 5 // open('/elsewhere/a').read()\"",
  ].map(writer),
  // A heredoc that only writes a file, whose body names outside paths as text, and a node -e regex
  // literal, pass.
  ordinary: [
    "cat > notes.md <<'EOF'\nSee /elsewhere/kore/a.ts and cp a /elsewhere/b\nEOF",
    "cat > notes.md <<-EOF\n\tcd ../../x\n\tEOF",
    "cat <<'EOF' >> docs/notes.md\nrm /elsewhere/b && cd ../..\nEOF",
    "tee docs/notes.md <<'EOF'\nrm /elsewhere/b\nEOF",
    "cat > a.md 2>&1 <<'A' <<'B'\none /elsewhere/x\nA\ntwo ../../y\nB",
    "cat > notes.md <<EOF\nCost is $5 in /elsewhere/b\nEOF",
    "node -e \"const re=/restrict|Pattern/i; console.log(re.test('abc'))\"",
  ].map((input) => ({ role: "writer", tool: "Bash" as const, input })),
};
