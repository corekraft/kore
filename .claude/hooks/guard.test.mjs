import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { evaluate, splitSegments } from "./guard.mjs";

const root = "/repo";
const sopsConfig = `creation_rules:
  - path_regex: infra/environments/local/secrets/.*\\.enc\\.yaml$
    encrypted_regex: '^(data|stringData)$'
`;
const vitestConfig = `thresholds: {
  statements: 95,
  branches: 84,
  functions: 94,
  lines: 95,
}`;

const files = {
  "/repo/.sops.yaml": sopsConfig,
  "/repo/tools/kore/vitest.config.ts": vitestConfig,
};
const ctx = {
  root,
  readFile: (path) => {
    if (path in files) return files[path];
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  },
};

const bash = (command) => evaluate({ tool_name: "Bash", tool_input: { command } }, ctx);
const write = (file_path, content) =>
  evaluate({ tool_name: "Write", tool_input: { file_path, content } }, ctx);
const edit = (file_path, old_string, new_string) =>
  evaluate({ tool_name: "Edit", tool_input: { file_path, old_string, new_string } }, ctx);
const read = (file_path) => evaluate({ tool_name: "Read", tool_input: { file_path } }, ctx);

const blocked = (result, rule) => {
  assert.equal(result.action, "block", JSON.stringify(result));
  assert.equal(result.rule, rule);
  assert.match(result.message, new RegExp(rule), "message names the rule");
  assert.match(result.message, /Instead|instead/, "message offers an alternative");
};
const allowed = (result) => assert.equal(result.action, "allow", JSON.stringify(result));

test("splitSegments separates chained commands but keeps quoted operators", () => {
  assert.deepEqual(splitSegments('a && b; c | d'), [["a"], ["b"], ["c"], ["d"]]);
  assert.deepEqual(splitSegments('echo "a && b"'), [["echo", "a && b"]]);
});

test("kubectl-context: kubectl without --context is blocked", () => {
  blocked(bash("kubectl get pods"), "kubectl-context");
  blocked(bash("cd x && kubectl apply -f a.yaml"), "kubectl-context");
  blocked(bash("KUBECONFIG=a kubectl get ns"), "kubectl-context");
});

test("kubectl-context: explicit context passes in both spellings", () => {
  allowed(bash("kubectl get pods --context kore-local"));
  allowed(bash("kubectl --context=kore-local get pods"));
});

test("kubectl-context: commands that never reach a cluster pass", () => {
  allowed(bash("kubectl config get-contexts"));
  allowed(bash("kubectl version --client"));
  allowed(bash('echo "kubectl get pods"'));
});

test("helm-context: cluster-touching helm without --kube-context is blocked", () => {
  blocked(bash("helm upgrade --install a ./chart"), "helm-context");
  blocked(bash("helm list -A"), "helm-context");
});

test("helm-context: explicit context and offline subcommands pass", () => {
  allowed(bash("helm upgrade --install a ./chart --kube-context kore-local"));
  allowed(bash("helm template a ./chart"));
  allowed(bash("helm lint ./chart"));
  allowed(bash("helm dependency update ./chart"));
});

test("destructive: cluster and infrastructure destruction is blocked", () => {
  blocked(bash("minikube delete"), "destructive");
  blocked(bash("minikube delete -p kore-local"), "destructive");
  blocked(bash("tofu destroy"), "destructive");
  blocked(bash("kubectl delete namespace apps --context kore-local"), "destructive");
  blocked(bash("kubectl delete ns apps --context kore-local"), "destructive");
  blocked(bash("helm uninstall a --kube-context kore-local"), "destructive");
  blocked(bash("./bin/kore cluster destroy --environment local"), "destructive");
  blocked(bash("npm --prefix tools/kore run kore -- platform destroy"), "destructive");
});

test("destructive: non-destructive siblings pass", () => {
  allowed(bash("minikube status"));
  allowed(bash("tofu plan"));
  allowed(bash("kubectl delete pod a --context kore-local"));
  allowed(bash("git commit -m 'feat: add destroy guard'"));
});

test("secret-path: reading key and token material is blocked", () => {
  blocked(read("/repo/.kore/keys/local/age.txt"), "secret-path");
  blocked(read("/repo/.kore/state/reference-api-token"), "secret-path");
  blocked(bash("cat .kore/keys/local/age.txt"), "secret-path");
  blocked(bash("echo hi > .kore/state/reference-api-token"), "secret-path");
  blocked(write("/repo/.kore/keys/local/age.txt", "x"), "secret-path");
  blocked(edit("/repo/.kore/state/reference-api-token", "a", "b"), "secret-path");
});

test("secret-path: listing and unrelated state files pass", () => {
  allowed(bash("ls .kore/keys"));
  allowed(read("/repo/.kore/state/local.json"));
  allowed(read("/repo/README.md"));
});

test("sops-plaintext: writing plaintext to an encrypted path is blocked", () => {
  const path = "/repo/infra/environments/local/secrets/db.enc.yaml";
  blocked(write(path, "stringData:\n  password: hunter2\n"), "sops-plaintext");
  blocked(edit(path, "a", "b"), "sops-plaintext");
  blocked(
    bash("echo 'stringData: {}' > infra/environments/local/secrets/db.enc.yaml"),
    "sops-plaintext",
  );
});

test("sops-plaintext: encrypted content and other paths pass", () => {
  const path = "/repo/infra/environments/local/secrets/db.enc.yaml";
  allowed(write(path, "stringData: ENC[...]\nsops:\n  version: 3.13.3\n"));
  allowed(write("/repo/infra/environments/local/values.yaml", "a: b\n"));
});

test("no-verify: skipping commit hooks is blocked", () => {
  blocked(bash("git commit --no-verify -m 'x'"), "no-verify");
  blocked(bash("git commit -n -m 'x'"), "no-verify");
  blocked(bash("git add . && git commit -nm 'x'"), "no-verify");
});

test("no-verify: ordinary commits pass", () => {
  allowed(bash("git commit -m 'fix: handle -n flag'"));
  allowed(bash("git commit -am 'chore: tidy'"));
  allowed(bash("git log -n 5"));
});

test("coverage-threshold: lowering a threshold is blocked", () => {
  const path = "/repo/tools/kore/vitest.config.ts";
  blocked(edit(path, "statements: 95", "statements: 90"), "coverage-threshold");
  blocked(write(path, vitestConfig.replace("lines: 95", "lines: 80")), "coverage-threshold");
});

test("coverage-threshold: keeping or raising a threshold passes", () => {
  const path = "/repo/tools/kore/vitest.config.ts";
  allowed(edit(path, "statements: 95", "statements: 96"));
  allowed(write(path, vitestConfig));
  allowed(edit(path, 'include: ["a"]', 'include: ["b"]'));
});

test("image-digest: tag-pinned images warn instead of blocking", () => {
  const result = write("/repo/apps/web/deployment.yaml", "image: ghcr.io/x/web:1.2.3\n");
  assert.equal(result.action, "warn");
  assert.equal(result.rule, "image-digest");
});

test("image-digest: digest-pinned images and bootstrap charts pass", () => {
  allowed(write("/repo/apps/web/deployment.yaml", `image: ghcr.io/x/web@sha256:${"a".repeat(64)}\n`));
  allowed(write("/repo/infra/charts/oci-registry/values.yaml", "image: registry:3.0.0\n"));
});

test("unrelated tools and empty input pass", () => {
  allowed(evaluate({ tool_name: "Glob", tool_input: { pattern: "*" } }, ctx));
  allowed(evaluate({}, ctx));
});

const hook = join(dirname(fileURLToPath(import.meta.url)), "guard.mjs");
const run = (payload) =>
  spawnSync("node", [hook], { input: JSON.stringify(payload), encoding: "utf8" });

test("cli: exits 2 and explains on stderr when blocking", () => {
  const result = run({ tool_name: "Bash", tool_input: { command: "minikube delete" } });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /destructive/);
});

test("cli: exits 0 silently when allowing", () => {
  const result = run({ tool_name: "Bash", tool_input: { command: "git status" } });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
});

test("cli: warns through additionalContext without blocking", () => {
  const result = run({
    tool_name: "Write",
    cwd: "/repo",
    tool_input: { file_path: "/repo/apps/web/d.yaml", content: "image: web:1\n" },
  });
  assert.equal(result.status, 0);
  assert.match(JSON.parse(result.stdout).hookSpecificOutput.additionalContext, /image-digest/);
});

test("cli: malformed input fails open", () => {
  const result = spawnSync("node", [hook], { input: "not json", encoding: "utf8" });
  assert.equal(result.status, 0);
});

test("cli: finishes well under the 200 ms budget", () => {
  const start = performance.now();
  run({ tool_name: "Bash", tool_input: { command: "git status" } });
  assert.ok(performance.now() - start < 200, "hook startup exceeded 200 ms");
});

test("unquoted-glob: an unquoted --include or --exclude glob warns, since zsh fails the whole command when it matches nothing", () => {
  for (const command of [
    "grep -rn foo --include=*.ts tools/kore/src",
    "grep -rn foo src --exclude=*.spec.ts | head",
  ]) {
    const result = bash(command);
    assert.equal(result.action, "warn", command);
    assert.equal(result.rule, "unquoted-glob", command);
    assert.match(result.message, /--(include|exclude)='\*/, command);
  }
});

test("unquoted-glob: quoted globs and globless flags pass", () => {
  for (const command of [
    "grep -rn foo --include='*.ts' src",
    'grep -rn foo "--include=*.ts" src',
    "grep -rn foo --include=app.ts src",
    "echo '--include=*.ts'",
  ]) {
    assert.equal(bash(command).action, "allow", command);
  }
});

test("unquoted-glob: a blocking rule in the same command still blocks", () => {
  blocked(bash("grep -rn x --include=*.ts . && kubectl get pods"), "kubectl-context");
});
