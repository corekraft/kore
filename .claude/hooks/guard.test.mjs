import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "./node-test-shim.mjs";
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

const bash = (command) =>
  evaluate({ tool_name: "Bash", tool_input: { command } }, ctx);
const write = (file_path, content) =>
  evaluate({ tool_name: "Write", tool_input: { file_path, content } }, ctx);
const edit = (file_path, old_string, new_string) =>
  evaluate(
    { tool_name: "Edit", tool_input: { file_path, old_string, new_string } },
    ctx,
  );
const read = (file_path) =>
  evaluate({ tool_name: "Read", tool_input: { file_path } }, ctx);

const blocked = (result, rule) => {
  assert.equal(result.action, "block", JSON.stringify(result));
  assert.equal(result.rule, rule);
  assert.match(result.message, new RegExp(rule), "message names the rule");
  assert.match(
    result.message,
    /Instead|instead/,
    "message offers an alternative",
  );
};
const allowed = (result) =>
  assert.equal(result.action, "allow", JSON.stringify(result));

test("splitSegments separates chained commands but keeps quoted operators", () => {
  assert.deepEqual(splitSegments("a && b; c | d"), [
    ["a"],
    ["b"],
    ["c"],
    ["d"],
  ]);
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

test("destructive: k3d cluster delete is blocked in any argument order and for any cluster", () => {
  blocked(bash("k3d cluster delete kore-local"), "destructive");
  blocked(bash("k3d cluster delete --all"), "destructive");
  blocked(bash("k3d cluster delete kore-local --all"), "destructive");
  blocked(bash("k3d --verbose cluster delete other"), "destructive");
  blocked(bash("k3d cluster --trace delete other"), "destructive");
  blocked(bash("k3d cluster delete -c ./k3d.yaml"), "destructive");
});

test("destructive: non-destructive k3d operations pass", () => {
  allowed(bash("k3d cluster list"));
  allowed(bash("k3d cluster get kore-local"));
  allowed(bash("k3d cluster start kore-local"));
  allowed(bash("k3d cluster stop kore-local"));
  allowed(bash("k3d image import kore:dev -c kore-local"));
});

test("destructive: cluster and infrastructure destruction is blocked", () => {
  blocked(bash("minikube delete"), "destructive");
  blocked(bash("minikube delete -p kore-local"), "destructive");
  blocked(bash("tofu destroy"), "destructive");
  blocked(
    bash("kubectl delete namespace apps --context kore-local"),
    "destructive",
  );
  blocked(bash("kubectl delete ns apps --context kore-local"), "destructive");
  blocked(bash("helm uninstall a --kube-context kore-local"), "destructive");
  blocked(
    bash("./bin/kore cluster destroy --environment local"),
    "destructive",
  );
  blocked(
    bash("npm --prefix tools/kore run kore -- platform destroy"),
    "destructive",
  );
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
  blocked(
    edit("/repo/.kore/state/reference-api-token", "a", "b"),
    "secret-path",
  );
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
    bash(
      "echo 'stringData: {}' > infra/environments/local/secrets/db.enc.yaml",
    ),
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
  blocked(
    write(path, vitestConfig.replace("lines: 95", "lines: 80")),
    "coverage-threshold",
  );
});

test("coverage-threshold: keeping or raising a threshold passes", () => {
  const path = "/repo/tools/kore/vitest.config.ts";
  allowed(edit(path, "statements: 95", "statements: 96"));
  allowed(write(path, vitestConfig));
  allowed(edit(path, 'include: ["a"]', 'include: ["b"]'));
});

test("image-digest: tag-pinned images warn instead of blocking", () => {
  const result = write(
    "/repo/apps/web/deployment.yaml",
    "image: ghcr.io/x/web:1.2.3\n",
  );
  assert.equal(result.action, "warn");
  assert.equal(result.rule, "image-digest");
});

test("image-digest: digest-pinned images and bootstrap charts pass", () => {
  allowed(
    write(
      "/repo/apps/web/deployment.yaml",
      `image: ghcr.io/x/web@sha256:${"a".repeat(64)}\n`,
    ),
  );
  allowed(
    write(
      "/repo/infra/charts/oci-registry/values.yaml",
      "image: registry:3.0.0\n",
    ),
  );
});

test("unrelated tools and empty input pass", () => {
  allowed(evaluate({ tool_name: "Glob", tool_input: { pattern: "*" } }, ctx));
  allowed(evaluate({}, ctx));
});

const hook = join(dirname(fileURLToPath(import.meta.url)), "guard.mjs");
const run = (payload) =>
  spawnSync("node", [hook], {
    input: JSON.stringify(payload),
    encoding: "utf8",
  });

test("cli: exits 2 and explains on stderr when blocking", () => {
  const result = run({
    tool_name: "Bash",
    tool_input: { command: "minikube delete" },
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /destructive/);
});

test("cli: exits 0 silently when allowing", () => {
  const result = run({
    tool_name: "Bash",
    tool_input: { command: "git status" },
  });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
});

test("cli: warns through additionalContext without blocking", () => {
  const result = run({
    tool_name: "Write",
    cwd: "/repo",
    tool_input: {
      file_path: "/repo/apps/web/d.yaml",
      content: "image: web:1\n",
    },
  });
  assert.equal(result.status, 0);
  assert.match(
    JSON.parse(result.stdout).hookSpecificOutput.additionalContext,
    /image-digest/,
  );
});

test("cli: malformed input fails open", () => {
  const result = spawnSync("node", [hook], {
    input: "not json",
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
});

const median = (xs) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)];
const timeMs = (fn, runs = 5) =>
  median(
    Array.from({ length: runs }, () => {
      const start = performance.now();
      fn();
      return performance.now() - start;
    }),
  );

test("cli: the guard adds at most 150 ms to the bare node startup", () => {
  // Measured against the same node binary, so a slow or loaded machine
  // raises the baseline instead of failing the guard's own budget.
  const baseline = timeMs(() => spawnSync("node", ["-e", "0"]));
  const guard = timeMs(() =>
    run({ tool_name: "Bash", tool_input: { command: "git status" } }),
  );
  assert.ok(
    guard <= baseline + 150,
    `guard median ${guard.toFixed(0)} ms exceeds node baseline ${baseline.toFixed(0)} ms + 150 ms`,
  );
}, 15_000);

test("unquoted-glob: an unquoted --include or --exclude glob blocks, since zsh fails the whole command when it matches nothing", () => {
  for (const command of [
    "grep -rn foo --include=*.ts tools/kore/src",
    "grep -rn foo src --exclude=*.spec.ts | head",
  ]) {
    const result = bash(command);
    assert.equal(result.action, "block", command);
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
    "python3 - <<'EOF'\nrun('grep x --include=*.ts')\nEOF",
  ]) {
    assert.equal(bash(command).action, "allow", command);
  }
});

test("bare-glob: an unquoted * or ? argument warns, since zsh fails the whole command when it matches nothing", () => {
  for (const [command, word] of [
    ["ls infra/*.yaml", "infra/*.yaml"],
    ["find . -name *.spec.ts", "*.spec.ts"],
    [
      "curl -s http://localhost:8080/health?full=1",
      "http://localhost:8080/health?full=1",
    ],
    ["echo $(ls src/*.ts)", "src/*.ts"],
  ]) {
    const result = bash(command);
    assert.equal(result.action, "warn", command);
    assert.equal(result.rule, "bare-glob", command);
    assert.ok(
      result.message.includes(`'${word}'`),
      `${command}: ${result.message}`,
    );
  }
});

test("bare-glob: quoted, escaped, parameter-expansion, and heredoc text pass", () => {
  for (const command of [
    "ls 'infra/*.yaml'",
    'find . -name "*.spec.ts"',
    "expr 2 \\* 3",
    'echo "${name%.*}"',
    "echo ${name%.*}",
    "echo $((2*3))",
    "git commit -F - <<'EOF'\n* a bullet line\nEOF",
    "git status",
  ]) {
    assert.equal(bash(command).action, "allow", command);
  }
});

test("bare-glob: special parameters like $? and $* are not globs", () => {
  for (const command of [
    "echo EXIT $?",
    'echo "EXIT $?"',
    "echo $# args: $* $@",
    "false; echo status=$?",
  ]) {
    assert.equal(bash(command).action, "allow", command);
  }
  assert.equal(bash("echo $? src/*.ts").rule, "bare-glob");
});

test("equals-word: an unquoted word starting with = warns, since zsh expands it as a command lookup", () => {
  for (const [command, word] of [
    ["echo =====", "====="],
    ['[ "$a" == "$b" ] && echo same', "=="],
  ]) {
    const result = bash(command);
    assert.equal(result.action, "warn", command);
    assert.equal(result.rule, "equals-word", command);
    assert.ok(
      result.message.includes(`'${word}'`),
      `${command}: ${result.message}`,
    );
  }
});

test("equals-word: quoted words, assignments, lone =, and [[ ]] tests pass", () => {
  for (const command of [
    "echo '====='",
    'echo "=="',
    "FOO=bar node x.mjs",
    '[ "$a" = "$b" ]',
    '[[ "$a" == "$b" ]] && echo same',
    "git log --format==%H",
  ]) {
    assert.equal(bash(command).action, "allow", command);
  }
});

test("bare-glob and equals-word: a blocking rule in the same command still blocks", () => {
  blocked(bash("ls src/*.ts && kubectl get pods"), "kubectl-context");
  blocked(bash("echo ==== && kubectl get pods"), "kubectl-context");
});

const HISTORY = ".claude/evals/history.jsonl";
const JOURNAL = ".kore/state/journal/local.jsonl";

const appendOnlyWarned = (result, label) => {
  assert.equal(result.action, "warn", `${label}: ${JSON.stringify(result)}`);
  assert.equal(result.rule, "append-only", label);
  assert.match(result.message, /\[guard:append-only\]/, label);
  assert.match(result.message, /eval\.mjs/, `${label}: names the eval owner`);
  assert.match(result.message, /kore/, `${label}: names the kore owner`);
  assert.match(result.message, /Instead/, `${label}: offers the fix`);
};

test("append-only: Edit and Write on a history or journal file warn, naming the owner and the fix", () => {
  for (const file of [HISTORY, JOURNAL]) {
    appendOnlyWarned(edit(`/repo/${file}`, "a", "b"), `Edit ${file}`);
    appendOnlyWarned(write(`/repo/${file}`, "{}\n"), `Write ${file}`);
  }
});

test("append-only: Bash that truncates, rewrites, moves, or removes the files warns", () => {
  for (const command of [
    `echo x > ${HISTORY}`,
    `echo x >${JOURNAL}`,
    `: > ${JOURNAL}`,
    `sed -i '' s/a/b/ ${HISTORY}`,
    `sed -i.bak s/a/b/ ${JOURNAL}`,
    `rm ${HISTORY}`,
    `rm -f .kore/state/journal/*.jsonl`,
    `mv ${JOURNAL} /tmp/x`,
    `mv /tmp/x ${HISTORY}`,
    `truncate -s 0 ${JOURNAL}`,
    `cd x && rm ${HISTORY}`,
    `echo x | tee ${HISTORY}`,
    `echo x | tee -p ${JOURNAL}`,
    `cp /tmp/x ${JOURNAL}`,
    `cp -f /tmp/x ${HISTORY}`,
    `rm -rf .kore/state/journal`,
    `rm -rf .kore/state/journal/`,
    `rm -rf .kore/state`,
    `rm -rf .kore/state/`,
    `rm -rf .kore`,
    `rm -rf .kore/`,
    `rm -rf /repo/.kore/state/journal`,
    `rm -rf /repo/.kore`,
    `mv .kore/state/journal x`,
    `mv .kore/state/journal/ x`,
    `mv .kore /tmp/x`,
  ]) {
    appendOnlyWarned(bash(command), command);
  }
});

test("append-only: appending and reading the files is allowed", () => {
  for (const command of [
    `echo x >> ${HISTORY}`,
    `echo x >>${JOURNAL}`,
    `cat ${HISTORY}`,
    `tail -n 5 ${JOURNAL}`,
    `grep fail ${HISTORY}`,
    `cat ${JOURNAL} > /tmp/copy.txt`,
    `rm /tmp/other.jsonl`,
    `echo x | tee -a ${HISTORY}`,
    `echo x | tee --append ${JOURNAL}`,
    `echo x | tee /tmp/other.txt`,
    `cp ${HISTORY} /tmp/backup.jsonl`,
    `cp ${JOURNAL} /tmp/dir/`,
    `echo x > .kore/state/other.txt`,
    `rm -rf .kore/locks/x`,
    `rm .kore/state/other.txt`,
  ]) {
    allowed(bash(command));
  }
  allowed(read(`/repo/${HISTORY}`));
  allowed(read(`/repo/${JOURNAL}`));
  allowed(edit("/repo/.claude/evals/other.jsonl", "a", "b"));
});

const LEDGER = ".kore/state/ledger.jsonl";

test("append-only: Edit and Write on the ledger warn, naming the harness ledger tool as owner", () => {
  for (const result of [
    edit(`/repo/${LEDGER}`, "a", "b"),
    write(`/repo/${LEDGER}`, "{}\n"),
  ]) {
    appendOnlyWarned(result, "ledger file tool");
    assert.match(result.message, /harness ledger/, "names the ledger tool");
  }
});

test("append-only: Bash that rewrites, truncates, moves, or removes the ledger warns", () => {
  for (const command of [
    `echo x > ${LEDGER}`,
    `: > ${LEDGER}`,
    `sed -i '' s/a/b/ ${LEDGER}`,
    `truncate -s 0 ${LEDGER}`,
    `mv ${LEDGER} /tmp/x`,
    `mv /tmp/x ${LEDGER}`,
    `rm ${LEDGER}`,
    `rm -f /repo/${LEDGER}`,
    `cp /tmp/x ${LEDGER}`,
    `echo x | tee ${LEDGER}`,
  ]) {
    const result = bash(command);
    appendOnlyWarned(result, command);
    assert.match(
      result.message,
      /harness ledger/,
      `${command}: names the tool`,
    );
  }
});

test("append-only: recording to and reading the ledger is allowed", () => {
  for (const command of [
    `echo x >> ${LEDGER}`,
    `cat ${LEDGER}`,
    `tail -n 5 ${LEDGER}`,
    `grep stage ${LEDGER}`,
    `cp ${LEDGER} /tmp/backup.jsonl`,
    `node skills/bin/harness.mjs ledger record --source claude --stage build --kind start`,
    `node skills/bin/harness.mjs ledger list`,
  ]) {
    allowed(bash(command));
  }
  allowed(read(`/repo/${LEDGER}`));
});

test("append-only: a blocking rule in the same command still blocks", () => {
  blocked(bash(`rm ${HISTORY} && kubectl get pods`), "kubectl-context");
});

const IDEA_FILE = "docs/ideas/0001-a.md";

const outcomeWarned = (result, label) => {
  assert.equal(result.action, "warn", `${label}: ${JSON.stringify(result)}`);
  assert.equal(result.rule, "idea-outcome", label);
  assert.match(result.message, /\[guard:idea-outcome\]/, label);
  assert.match(
    result.message,
    /#187/,
    `${label}: names the ticket that adds the tool`,
  );
  assert.doesNotMatch(
    result.message,
    /harness outcome/,
    `${label}: names no command that does not exist yet`,
  );
  assert.match(result.message, /Instead/, `${label}: offers the fix`);
};

test("idea-outcome: hand-written outcome sections or fields in an idea warn, naming the ticket that adds the tool", () => {
  outcomeWarned(
    write(`/repo/${IDEA_FILE}`, "---\nstatus: closed\noutcome: refuted\n---\n"),
    "Write outcome field",
  );
  outcomeWarned(
    edit(`/repo/${IDEA_FILE}`, "x", "## Outcome\n\nIt worked.\n"),
    "Edit heading",
  );
  outcomeWarned(
    edit(`/repo/${IDEA_FILE}`, "x", "### outcome\n"),
    "Edit lowercase sub-heading",
  );
});

test("idea-outcome: other idea edits and other files are not warned", () => {
  for (const result of [
    edit(`/repo/${IDEA_FILE}`, "a", "## Expected outcome\n"),
    write(`/repo/${IDEA_FILE}`, "---\nexpected-outcome: faster\n---\n"),
    write("/repo/docs/guides/x.md", "## Outcome\n"),
    read(`/repo/${IDEA_FILE}`),
  ]) {
    assert.equal(result.action, "allow", JSON.stringify(result));
  }
});

const bodyWarned = (result, label) => {
  assert.equal(result.action, "warn", `${label}: ${JSON.stringify(result)}`);
  assert.equal(result.rule, "idea-issue-body", label);
  assert.match(result.message, /\[guard:idea-issue-body\]/, label);
  assert.match(result.message, /harness idea sync/, label);
  assert.match(result.message, /Instead/, label);
};

test("idea-issue-body: editing an issue body by hand warns and names the sync tool", () => {
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
    bodyWarned(bash(command), command);
  }
});

test("idea-issue-body: label, assignee and read commands are not warned", () => {
  for (const command of [
    "gh issue edit 186 --add-label ready-for-agent",
    "gh issue edit 186 --add-assignee junners",
    "gh issue view 186 --json body",
    "gh issue comment 186 --body 'note'",
    "gh pr edit 12 --body 'x'",
  ]) {
    assert.equal(bash(command).action, "allow", command);
  }
});
