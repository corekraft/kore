// The judgment role's corpus cases (ADR 0121, #873): every write, git mutation and gh mutation it
// attempts must be refused, and the reads it needs must keep running. guard-corpus.ts runs them through
// the hook.
import type { CorpusCase, OrdinaryCase } from "./guard-corpus.js";

const bash = (rule: string, ...commands: string[]) =>
  commands.map((input): CorpusCase => ({
    role: "judgment",
    tool: "Bash",
    input,
    rule,
  }));

/** The judgment role (ADR 0121, #873) reads and reports a plan: no write, git mutation or gh mutation. */
const JUDGMENT_MUTATIONS = bash(
  "role-read-only",
  "git add .",
  "git commit -m x",
  "git commit --allow-empty -m x",
  "git push origin HEAD",
  "git push --force origin main",
  "git checkout -b x",
  "git switch -c x",
  "git reset --hard HEAD~1",
  "git merge origin/main",
  "git rebase origin/main",
  "git stash",
  "git branch -D x",
  "git tag v1",
  "git worktree add ../x",
  "git rm file",
  "git config user.name x",
  "gh pr create --fill",
  "gh pr merge 1 --squash",
  "gh pr edit 1 --add-label x",
  "gh pr close 1",
  "gh pr comment 1 --body x",
  "gh pr review 1 --approve",
  "gh issue create --title x",
  "gh issue comment 1 --body x",
  "gh issue edit 1 --add-label needs-info",
  "gh issue close 1",
  "gh label create x",
  "gh api -X POST /repos/corekraft/kore/issues/1/comments",
  "gh workflow run check.yml",
  "node skills/bin/harness.mjs session spawn --role reader --name x --brief b",
  "node skills/bin/harness.mjs flag activate x",
  "node skills/bin/harness.mjs outcome record --idea 1",
  "node skills/bin/harness.mjs decision make --idea 1 --category c --question q --decision d",
  "node skills/bin/harness.mjs pr open --title t --pattern p --issue 1 --body b",
  "herdr pane send-text w3:p1 hi",
  "rm -rf docs",
  "touch x",
  "cp a b",
  "mv a b",
  "tee out.txt",
  "sed -i s/a/b/ file",
  "echo x | tee file",
  "node -e 1",
  "bash -c 'echo x'",
);

/** The judgment role may not use the file tools to change anything, in the repository or beside it. */
const JUDGMENT_FILE_TOOLS = ["Write", "Edit"].flatMap((tool) =>
  ["docs/index.md", ".claude/agents/judgment.md", "/tmp/plan.json"].map(
    (input): CorpusCase => ({
      role: "judgment",
      tool: tool as "Write" | "Edit",
      input,
      rule: "role-read-only",
    }),
  ),
);

/** The reads the judgment role needs, allowed by their exact argv shape. */
const JUDGMENT_COMMANDS = [
  "gh pr view 1",
  "gh pr list --state open",
  "gh pr checks 1",
  "gh pr diff 1",
  "gh issue view 873",
  "gh issue list --label ready-for-agent",
  "git log --oneline origin/main -5",
  "git diff origin/main...HEAD",
  "git show HEAD",
  "git status",
  "node skills/bin/harness.mjs plan active",
  "node skills/bin/harness.mjs idea show 7",
  "node skills/bin/harness.mjs ledger list",
  "grep -rn judgment docs",
  "rg judgment tools/harness/src",
];

/** Every call the judgment role keeps: the commands above and the file-tool reads. */
export const JUDGMENT_ALLOWED: readonly OrdinaryCase[] = [
  ...JUDGMENT_COMMANDS.map((input): OrdinaryCase => ({
    role: "judgment",
    tool: "Bash",
    input,
  })),
  { role: "judgment", tool: "Read", input: "docs/index.md" },
  { role: "judgment", tool: "Grep", input: "docs", pattern: "plan" },
  { role: "judgment", tool: "Glob", input: "docs/decisions" },
];

/** Every call the judgment role must be refused. */
export const JUDGMENT_REFUSED: readonly CorpusCase[] = [
  ...JUDGMENT_MUTATIONS,
  ...JUDGMENT_FILE_TOOLS,
];
