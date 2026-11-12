import assert from "node:assert/strict";
import { it } from "vitest";
import { bash, blocked } from "./guard-support.js";

it("unquoted-glob: an unquoted --include or --exclude glob blocks, since zsh fails the whole command when it matches nothing", async () => {
  for (const command of [
    "grep -rn foo --include=*.ts tools/kore/src",
    "grep -rn foo src --exclude=*.spec.ts | head",
  ]) {
    const result = await bash(command);
    assert.equal(result.action, "block", command);
    assert.equal(result.rule, "unquoted-glob", command);
    assert.match(result.message, /--(include|exclude)='\*/, command);
  }
});

it("unquoted-glob: quoted globs and globless flags pass", async () => {
  for (const command of [
    "grep -rn foo --include='*.ts' src",
    'grep -rn foo "--include=*.ts" src',
    "grep -rn foo --include=app.ts src",
    "echo '--include=*.ts'",
    "python3 - <<'EOF'\nrun('grep x --include=*.ts')\nEOF",
  ]) {
    assert.equal((await bash(command)).action, "allow", command);
  }
});

it("bare-glob: an unquoted * or ? argument warns, since zsh fails the whole command when it matches nothing", async () => {
  for (const [command, word] of [
    ["ls infra/*.yaml", "infra/*.yaml"],
    ["find . -name *.spec.ts", "*.spec.ts"],
    [
      "curl -s http://localhost:8080/health?full=1",
      "http://localhost:8080/health?full=1",
    ],
    ["echo $(ls src/*.ts)", "src/*.ts"],
  ] as [string, string][]) {
    const result = await bash(command);
    assert.equal(result.action, "warn", command);
    assert.equal(result.rule, "bare-glob", command);
    assert.ok(
      result.message.includes(`'${word}'`),
      `${command}: ${result.message}`,
    );
  }
});

it("bare-glob: quoted, escaped, parameter-expansion, and heredoc text pass", async () => {
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
    assert.equal((await bash(command)).action, "allow", command);
  }
});

it("bare-glob: special parameters like $? and $* are not globs", async () => {
  for (const command of [
    "echo EXIT $?",
    'echo "EXIT $?"',
    "echo $# args: $* $@",
    "false; echo status=$?",
  ]) {
    assert.equal((await bash(command)).action, "allow", command);
  }
  assert.equal((await bash("echo $? src/*.ts")).rule, "bare-glob");
});

it("equals-word: an unquoted word starting with = blocks, since zsh expands it as a command lookup", async () => {
  for (const [command, word] of [
    ["echo =====", "====="],
    ['[ "$a" == "$b" ] && echo same', "=="],
  ] as [string, string][]) {
    const result = await bash(command);
    assert.equal(result.action, "block", command);
    assert.equal(result.rule, "equals-word", command);
    assert.ok(
      result.message.includes(`'${word}'`),
      `${command}: ${result.message}`,
    );
  }
});

it("equals-word: quoted words, assignments, lone =, and [[ ]] tests pass", async () => {
  for (const command of [
    "echo '====='",
    'echo "=="',
    "FOO=bar node x.mjs",
    '[ "$a" = "$b" ]',
    '[[ "$a" == "$b" ]] && echo same',
    "git log --format==%H",
    "(( a == b ))",
    "if (( n == 0 )); then :; fi",
  ]) {
    assert.equal((await bash(command)).action, "allow", command);
  }
});

it("bare-glob and equals-word: a blocking rule in the same command still blocks", async () => {
  blocked(await bash("ls src/*.ts && kubectl get pods"), "kubectl-context");
  blocked(await bash("echo ==== && kubectl get pods"), "kubectl-context");
});
