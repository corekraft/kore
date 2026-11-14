import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkDeliveryBash } from "../../src/hook/index.js";
import { allowed, blocked, decide } from "../../src/testing/index.js";

const as = (agent_type: string, tool_name: string, tool_input: object) =>
  decide({ agent_type, tool_name, tool_input });
const bash = (role: string, command: string) => as(role, "Bash", { command });

const MERGES = [
  "gh pr merge 12 --squash",
  "cd x && gh pr merge 12 --auto",
  "gh api -X PUT repos/corekraft/kore/pulls/12/merge",
  "gh api repos/corekraft/kore/pulls/12/merge --method PUT",
];

describe("role-no-merge: the merge tool is the only way a role merges", () => {
  it("blocks the orchestrator, writer and judge from merging by any other path", async () => {
    for (const role of ["orchestrator", "writer", "judge"]) {
      for (const command of MERGES) {
        blocked(await bash(role, command), "role-no-merge");
      }
    }
  });

  it("points a blocked merge at the merge tool", async () => {
    const result = await bash("judge", "gh pr merge 12 --squash");
    assert.match(result.message, /harness judge merge/);
  });

  it("lets only the judge run the merge and send-back tools", async () => {
    allowed(
      await bash(
        "judge",
        "node skills/bin/harness.mjs judge merge 12 --reviewer bot --json",
      ),
    );
    allowed(
      await bash(
        "judge",
        'node skills/bin/harness.mjs judge send-back 12 --reason "no pattern"',
      ),
    );
    for (const role of ["orchestrator", "writer"]) {
      blocked(
        await bash(role, "node skills/bin/harness.mjs judge merge 12"),
        "role-no-merge",
      );
    }
    blocked(
      await bash(
        "orchestrator",
        "node skills/bin/harness.mjs judge send-back 12 --reason x",
      ),
      "role-no-merge",
    );
  });

  it("still blocks the judge from merging through a chained or wrapped call", async () => {
    blocked(
      await bash(
        "judge",
        "node skills/bin/harness.mjs judge merge 12 && gh pr merge 13 --squash",
      ),
      "role-no-merge",
    );
    blocked(
      await bash(
        "judge",
        "node skills/bin/harness.mjs judge merge 12 --ledger /tmp/x.jsonl",
      ),
      "role-read-only",
    );
  });
});

describe("role-no-merge: what stays allowed", () => {
  it("still lets them read a pull request and mention merge in text", async () => {
    for (const role of ["orchestrator", "writer", "judge"]) {
      allowed(await bash(role, "gh pr view 12 --json mergeable"));
      allowed(await bash(role, 'echo "gh pr merge 12"'));
    }
  });

  it("does not bind a session with no role, so the person keeps gh pr merge --squash", async () => {
    allowed(
      await decide({
        tool_name: "Bash",
        tool_input: { command: "gh pr merge 12 --squash" },
      }),
    );
    allowed(
      await decide({
        agent_type: "",
        tool_name: "Bash",
        tool_input: { command: "gh pr merge 12 --squash" },
      }),
    );
  });

  it("does not bind an unknown role", async () => {
    allowed(await bash("someone-else", "gh pr merge 12"));
  });
});

const WRAPPED_MERGES = [
  "/usr/bin/env gh pr merge 12 --squash",
  "env GH_TOKEN=x gh pr merge 12",
  "env -i gh pr merge 12",
  'bash -c "gh pr merge 12 --squash"',
  "sh -c 'cd x && gh pr merge 12'",
  "bash -lc 'gh pr merge 12'",
  "echo 12 | xargs gh pr merge",
  "echo 12 | xargs -n1 gh pr merge --squash",
  "echo 12 | xargs -I{} gh pr merge {}",
  'eval "gh pr merge 12"',
  "gh -R corekraft/kore pr merge 12",
  "gh pr merge --repo corekraft/kore 12",
  "gh api graphql -f query='mutation { mergePullRequest(input: {pullRequestId: \"x\"}) { clientMutationId } }'",
  "gh api graphql -F query=@merge.graphql",
  "gh api graphql -f query=@merge.graphql",
  "gh api graphql --input merge.json",
  "gh api graphql -f query='mutation { enablePullRequestAutoMerge(input: {}) { clientMutationId } }'",
];

describe("role-no-merge: wrapped and graphql merges", () => {
  it("blocks every role-bound pane from each wrapped or graphql merge form", async () => {
    for (const role of ["orchestrator", "writer", "judge"]) {
      for (const command of WRAPPED_MERGES) {
        blocked(await bash(role, command), "role-no-merge");
      }
    }
  });

  it("leaves a session with no role every form, and graphql reads", async () => {
    for (const command of WRAPPED_MERGES) {
      allowed(await decide({ tool_name: "Bash", tool_input: { command } }));
    }
    allowed(
      await bash("writer", "gh api graphql -f query='{ viewer { login } }'"),
    );
    allowed(await bash("writer", "env gh pr view 12"));
    allowed(await bash("writer", 'bash -c "gh pr view 12"'));
  });
});

const PUSHES_TO_MAIN = [
  "git push origin HEAD:main",
  "git push origin main",
  "git push origin +main",
  "git push origin +HEAD:main",
  "git push origin HEAD:refs/heads/main",
  "git push origin feat/x:main",
  "git push origin :main",
  "git push --force origin main",
  "git push -u origin main",
  "git push --all origin",
  "git push --mirror",
  "git -C . push origin main",
  "git push origin 'refs/heads/*:refs/heads/*'",
  'bash -c "git push origin HEAD:main"',
  "env git push origin main",
  "echo main | xargs git push origin",
];

describe("role-no-merge: no role-bound pane pushes to main", () => {
  it("blocks every push whose target is main, for every role", async () => {
    for (const role of ["orchestrator", "writer", "judge"]) {
      for (const command of PUSHES_TO_MAIN) {
        blocked(await bash(role, command), "role-no-merge");
      }
    }
  });

  it("leaves a session with no role every push", async () => {
    for (const command of PUSHES_TO_MAIN) {
      allowed(await decide({ tool_name: "Bash", tool_input: { command } }));
    }
  });
});

describe("role-no-merge: a push with no named target goes where the branch tracks", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  const repo = (branch: string, merge?: string): string => {
    const dir = mkdtempSync(join(tmpdir(), "guard-push-"));
    dirs.push(dir);
    // No GIT_*: under a git hook GIT_DIR names the real repository, which `git init` and `git config` would change.
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
    );
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: dir, env, stdio: "ignore" });
    git("init", "-q", "-b", branch);
    if (merge !== undefined) {
      git("config", `branch.${branch}.merge`, merge);
    }
    return dir;
  };
  const push = (dir: string, command: string) =>
    checkDeliveryBash("writer", command, dir);

  it("blocks a bare push from main, or from a branch that tracks main", () => {
    for (const command of [
      "git push",
      "git push origin",
      "git push -u origin HEAD",
      "git push origin HEAD",
    ]) {
      expect(push(repo("main"), command)?.rule).toBe("role-no-merge");
      expect(push(repo("feat/x", "refs/heads/main"), command)?.rule).toBe(
        "role-no-merge",
      );
    }
  });

  it("allows a writer to push its own branch by name, and a bare push that tracks its own branch or nothing", () => {
    for (const command of [
      "git push -u origin mybranch",
      "git push --force-with-lease origin mybranch",
      "git push origin mybranch:mybranch",
      "git push origin HEAD:mybranch",
    ]) {
      expect(push(repo("main"), command)).toBeNull();
    }
    for (const command of [
      "git push",
      "git push -u origin HEAD",
      "git push origin HEAD",
    ]) {
      expect(push(repo("feat/x", "refs/heads/feat/x"), command)).toBeNull();
      expect(push(repo("feat/x"), command)).toBeNull();
    }
  });

  it("fails closed when the branch cannot be read", () => {
    expect(checkDeliveryBash("writer", "git push", tmpdir())?.rule).toBe(
      "role-no-merge",
    );
  });
});
