import assert from "node:assert/strict";
import { it } from "vitest";
import { allowed, bash, blocked, type Result } from "../testing/index.js";
import * as commands from "./guard-commands.js";
import { splitSegments } from "./guard-shell.js";

it("guard-commands exports only the command rules it owns, so no glob rule is re-exported through it", () => {
  assert.deepEqual(Object.keys(commands).sort(), [
    "checkAgentStart",
    "checkContext",
    "checkDestructive",
    "checkIdeaIssueBody",
    "checkIdeaIssueClose",
    "checkNoVerify",
  ]);
});

it("splitSegments separates chained commands but keeps quoted operators", async () => {
  assert.deepEqual(splitSegments("a && b; c | d"), [
    ["a"],
    ["b"],
    ["c"],
    ["d"],
  ]);
  assert.deepEqual(splitSegments('echo "a && b"'), [["echo", "a && b"]]);
});

it("kubectl-context: kubectl without --context is blocked", async () => {
  blocked(await bash("kubectl get pods"), "kubectl-context");
  blocked(await bash("cd x && kubectl apply -f a.yaml"), "kubectl-context");
  blocked(await bash("KUBECONFIG=a kubectl get ns"), "kubectl-context");
});

it("kubectl-context: explicit context passes in both spellings", async () => {
  allowed(await bash("kubectl get pods --context kore-local"));
  allowed(await bash("kubectl --context=kore-local get pods"));
});

it("kubectl-context: commands that never reach a cluster pass", async () => {
  allowed(await bash("kubectl config get-contexts"));
  allowed(await bash("kubectl version --client"));
  allowed(await bash('echo "kubectl get pods"'));
});

it("helm-context: cluster-touching helm without --kube-context is blocked", async () => {
  blocked(await bash("helm upgrade --install a ./chart"), "helm-context");
  blocked(await bash("helm list -A"), "helm-context");
});

it("helm-context: explicit context and offline subcommands pass", async () => {
  allowed(
    await bash("helm upgrade --install a ./chart --kube-context kore-local"),
  );
  allowed(await bash("helm template a ./chart"));
  allowed(await bash("helm lint ./chart"));
  allowed(await bash("helm dependency update ./chart"));
});

it("destructive: k3d cluster delete is blocked in any argument order and for any cluster", async () => {
  blocked(await bash("k3d cluster delete kore-local"), "destructive");
  blocked(await bash("k3d cluster delete --all"), "destructive");
  blocked(await bash("k3d cluster delete kore-local --all"), "destructive");
  blocked(await bash("k3d --verbose cluster delete other"), "destructive");
  blocked(await bash("k3d cluster --trace delete other"), "destructive");
  blocked(await bash("k3d cluster delete -c ./k3d.yaml"), "destructive");
});

it("destructive: non-destructive k3d operations pass", async () => {
  allowed(await bash("k3d cluster list"));
  allowed(await bash("k3d cluster get kore-local"));
  allowed(await bash("k3d cluster start kore-local"));
  allowed(await bash("k3d cluster stop kore-local"));
  allowed(await bash("k3d image import kore:dev -c kore-local"));
});

it("destructive: cluster and infrastructure destruction is blocked", async () => {
  blocked(await bash("k3d cluster delete kore-local"), "destructive");
  blocked(await bash("k3d cluster delete --all"), "destructive");
  blocked(await bash("tofu destroy"), "destructive");
  blocked(
    await bash("kubectl delete namespace apps --context kore-local"),
    "destructive",
  );
  blocked(
    await bash("kubectl delete ns apps --context kore-local"),
    "destructive",
  );
  blocked(
    await bash("helm uninstall a --kube-context kore-local"),
    "destructive",
  );
  blocked(
    await bash("./bin/kore cluster destroy --environment local"),
    "destructive",
  );
  blocked(
    await bash("npm --prefix tools/kore run kore -- platform destroy"),
    "destructive",
  );
});

it("destructive: non-destructive siblings pass", async () => {
  allowed(await bash("k3d cluster list"));
  allowed(await bash("tofu plan"));
  allowed(await bash("kubectl delete pod a --context kore-local"));
  allowed(await bash("git commit -m 'feat: add destroy guard'"));
});

it("no-verify: skipping commit hooks is blocked", async () => {
  blocked(await bash("git commit --no-verify -m 'x'"), "no-verify");
  blocked(await bash("git commit -n -m 'x'"), "no-verify");
  blocked(await bash("git add . && git commit -nm 'x'"), "no-verify");
});

it("no-verify: ordinary commits pass", async () => {
  allowed(await bash("git commit -m 'fix: handle -n flag'"));
  allowed(await bash("git commit -am 'chore: tidy'"));
  allowed(await bash("git log -n 5"));
});

const bodyWarned = (result: Result, label: string) => {
  assert.equal(result.action, "warn", `${label}: ${JSON.stringify(result)}`);
  assert.equal(result.rule, "idea-issue-body", label);
  assert.match(result.message, /\[guard:idea-issue-body\]/, label);
  assert.match(result.message, /harness idea sync/, label);
  assert.match(result.message, /Instead/, label);
};

it("idea-issue-body: editing an issue body by hand warns and names the sync tool", async () => {
  for (const command of [
    "gh issue edit 186 --body 'new text'",
    "gh issue edit 186 -b 'new text'",
    "gh issue edit 186 --body-file notes.md",
    "gh issue edit 186 -F notes.md",
    "gh issue edit 186 --repo corekraft/kore --body=x",
    "gh issue edit 186 --body-file -",
    "gh issue edit 186 --title 'x'",
    "gh issue edit 186 -t x",
  ]) {
    bodyWarned(await bash(command), command);
  }
});

it("idea-issue-body: label, assignee and read commands are not warned", async () => {
  for (const command of [
    "gh issue edit 186 --add-label ready-for-agent",
    "gh issue edit 186 --add-assignee junners",
    "gh issue view 186 --json body",
    "gh issue comment 186 --body 'note'",
    "gh pr edit 12 --body 'x'",
  ]) {
    assert.equal((await bash(command)).action, "allow", command);
  }
});

const closeWarned = (result: Result, label: string) => {
  assert.equal(result.action, "warn", `${label}: ${JSON.stringify(result)}`);
  assert.equal(result.rule, "idea-issue-close", label);
  assert.match(result.message, /\[guard:idea-issue-close\]/, label);
  assert.match(result.message, /harness outcome close/, label);
  assert.match(result.message, /Instead/, label);
};

it("idea-issue-close: closing an issue or setting an outcome label by hand warns and names the outcome tool", async () => {
  for (const command of [
    "gh issue close 186",
    "gh issue close 186 --reason completed --repo corekraft/kore",
    "gh issue edit 186 --add-label outcome:confirmed",
    "gh issue edit 186 --add-label=outcome:refuted",
    "gh issue edit 186 -l outcome:confirmed",
    "gh issue edit 186 --add-label ready-for-agent,outcome:inconclusive",
  ]) {
    closeWarned(await bash(command), command);
  }
});

it("idea-issue-close: other label edits, reads and comments are not warned", async () => {
  for (const command of [
    "gh issue edit 186 --add-label ready-for-agent",
    "gh issue edit 186 --remove-label needs-triage",
    "gh issue view 186",
    "gh issue comment 186 --body 'note'",
    "gh pr close 12",
  ]) {
    assert.equal((await bash(command)).action, "allow", command);
  }
});
