// Bypass and ordinary cases for the role-worktree path check's text rules (guard-text.ts): a heredoc
// body is text unless a shell or interpreter runs it, and a node -e string literal is a path while a
// regex literal is not. Part of the corpus in guard-corpus.ts, which the integration spec runs through
// `hook guard`; the cases live here so guard-corpus.ts stays within its size limit.

import type { CorpusCase } from "./guard-corpus.js";

const writer = (input: string): CorpusCase => ({
  role: "writer",
  tool: "Bash",
  input,
  rule: "role-worktree",
});

export const HEREDOC = {
  // A heredoc body a shell or interpreter runs is code, and a node -e read of an outside path is a
  // read: both stay refused.
  corpus: [
    "bash <<'EOF'\ncp a /elsewhere/b\nEOF",
    "cat <<'EOF' | sh\nrm /elsewhere/b\nEOF",
    "cat <<EOF > a.sh\nrm /elsewhere/b\nEOF\nsh a.sh",
    "node -e \"require('fs').readFileSync('/elsewhere/kore/a.ts')\"",
    "node -e \"require('fs').readFileSync('../../../secret')\"",
  ].map(writer),
  // A heredoc whose body names outside paths only as text, and a node -e regex literal, pass.
  ordinary: [
    "cat > notes.md <<'EOF'\nSee /elsewhere/kore/a.ts and cp a /elsewhere/b\nEOF",
    "cat > notes.md <<-EOF\n\tcd ../../x\n\tEOF",
    "node -e \"const re=/restrict|Pattern/i; console.log(re.test('abc'))\"",
  ].map((input) => ({ role: "writer", tool: "Bash" as const, input })),
};
