import { describe, expect, it } from "vitest";
import { checkDeliveryBash } from "./guard-role-delivery.js";
import { allowed, blocked, decide } from "../testing/index.js";

const as = (agent_type: string, command: string) =>
  decide({ agent_type, tool_name: "Bash", tool_input: { command } });
const bare = (command: string) =>
  decide({ tool_name: "Bash", tool_input: { command } });

/** Routes to main or past the main ruleset that no role-bound pane may take. */
const EVERY_ROLE = [
  "gh api repos/corekraft/kore/merges -f base=main -f head=x",
  "gh api -X POST repos/corekraft/kore/merges",
  "gh api repos/corekraft/kore/merge-upstream -f branch=main",
  "gh api -X POST repos/corekraft/kore/git/refs -f ref=refs/heads/main -f sha=abc",
  "gh api -X PATCH repos/corekraft/kore/git/refs/heads/main -f sha=abc -F force=true",
  "gh api --method DELETE repos/corekraft/kore/git/refs/heads/x",
  "gh api repos/corekraft/kore/git/refs -f ref=refs/heads/x -f sha=y",
  "gh api -X PUT repos/corekraft/kore/contents/a.md -f message=x -f branch=main",
  "gh api -X DELETE repos/corekraft/kore/rulesets/12",
  "gh api -X PUT repos/corekraft/kore/branches/main/protection --input p.json",
  "gh alias set m 'pr merge'",
  "gh alias set --shell m 'gh pr merge $1'",
  "gh alias import aliases.yml",
  "git -c remote.origin.push=HEAD:main push origin",
  "git -c push.default=upstream push",
  "git -c branch.feat.merge=refs/heads/main push",
  "git -c remote.origin.pushurl=/x push origin feat",
  "git --config-env=remote.origin.push=PUSHSPEC push origin",
  "echo $(gh pr merge 12 --squash)",
  "echo `gh pr merge 12`",
  "ls $(echo $(git push origin main))",
];

/** More only the writer can reach: it has the full shell, the read-only roles do not. */
const WRITER_ONLY = [
  "git config remote.origin.push HEAD:main",
  "git config --local branch.feat.merge refs/heads/main",
  "git config --global push.default upstream",
  "git config --add remote.origin.push main",
  "git config --unset remote.origin.url",
  "git config --replace-all branch.main.remote origin",
  "git push --repo=origin main",
  "git push --repo origin main",
  "time -p gh pr merge 12",
  "/usr/bin/time -p gh pr merge 12",
  "sudo -u root gh pr merge 12",
  "time -p git push origin main",
  'gh api graphql -f query="$Q"',
  "gh api graphql -f query='query($id: ID!) { node(id: $id) { id } }'",
  'gh api graphql -f query="$(cat q.graphql)"',
  "gh auth token",
  "gh auth token --hostname github.com",
  "gh auth status --show-token",
  "gh auth status -t",
  "gh auth git-credential get",
  'curl -X PUT -H "Authorization: Bearer $(gh auth token)" https://api.github.com/repos/corekraft/kore/pulls/12/merge',
  'curl -H "Authorization: Bearer `gh auth token`" https://api.github.com/user',
  "echo $(gh auth token)",
  "TOKEN=$(gh auth token) ./push.sh",
  'curl -H "Authorization: Bearer $(echo $(gh auth token))" https://api.github.com/user',
  'curl -H "Authorization: Bearer $(cat <(gh auth token))" https://api.github.com/user',
];

describe("role-no-merge: the cheap routes around the merge tool", () => {
  it("blocks every role-bound pane from each api, alias and git -c route", async () => {
    for (const role of ["orchestrator", "writer", "judge"]) {
      for (const command of EVERY_ROLE) {
        blocked(await as(role, command), "role-no-merge");
      }
    }
  });

  it("blocks the writer from each config write, --repo, wrapper and token route", async () => {
    for (const command of WRITER_ONLY) {
      blocked(await as("writer", command), "role-no-merge");
    }
  });

  it("leaves a session with no role every one of them", async () => {
    for (const command of [...EVERY_ROLE, ...WRITER_ONLY]) {
      allowed(await bare(command));
    }
  });

  it("still lets a writer read through gh api and git config, and run a timed command", async () => {
    for (const command of [
      "gh api repos/corekraft/kore/pulls/12",
      "gh api repos/corekraft/kore/git/refs/heads/main",
      "gh api -X GET repos/corekraft/kore/git/refs -f per_page=5",
      "gh api graphql -f query='{ viewer { login } }'",
      "gh auth status",
      "git config --get remote.origin.url",
      "git config --get branch.main.merge",
      "git config -l",
      "git config user.name tester",
      "git -c core.pager=cat log -1",
      "time -p ls",
    ]) {
      allowed(await as("writer", command));
    }
  });
});

describe("role-worktree: a writer's ordinary branch push passes", () => {
  it("does not read feat/x in a push as an absolute path", async () => {
    for (const command of [
      "git push -u origin feat/x",
      "git push -u origin feat/judge-merge-tool",
      "git push --force-with-lease origin feat/x:feat/x",
      "git push origin HEAD:feat/x",
    ]) {
      allowed(await as("writer", command));
    }
  });

  it("still reads a real absolute or parent path as outside the worktree", () => {
    for (const command of [
      "git push origin feat/x > /etc/out",
      "cp a ../b",
      "tee --output=/etc/x",
      "dd of=/etc/x",
    ]) {
      expect(checkDeliveryBash("writer", command, "/repo")?.rule).toBe(
        "role-worktree",
      );
    }
  });
});
