import assert from "node:assert/strict";
import { it } from "vitest";
import {
  allowed,
  bash,
  blocked,
  edit,
  read,
  write,
  type Result,
} from "./guard-support.js";

const HISTORY = ".claude/evals/history.jsonl";
const JOURNAL = ".kore/state/journal/local.jsonl";

const appendOnlyWarned = (result: Result, label: string) => {
  assert.equal(result.action, "warn", `${label}: ${JSON.stringify(result)}`);
  assert.equal(result.rule, "append-only", label);
  assert.match(result.message, /\[guard:append-only\]/, label);
  assert.match(result.message, /eval\.mjs/, `${label}: names the eval owner`);
  assert.match(result.message, /kore/, `${label}: names the kore owner`);
  assert.match(result.message, /Instead/, `${label}: offers the fix`);
};

it("append-only: Edit and Write on a history or journal file warn, naming the owner and the fix", async () => {
  for (const file of [HISTORY, JOURNAL]) {
    appendOnlyWarned(await edit(`/repo/${file}`, "a", "b"), `Edit ${file}`);
    appendOnlyWarned(await write(`/repo/${file}`, "{}\n"), `Write ${file}`);
  }
});

it("append-only: Bash that truncates, rewrites, moves, or removes the files warns", async () => {
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
    appendOnlyWarned(await bash(command), command);
  }
});

it("append-only: appending and reading the files is allowed", async () => {
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
    allowed(await bash(command));
  }
  allowed(await read(`/repo/${HISTORY}`));
  allowed(await read(`/repo/${JOURNAL}`));
  allowed(await edit("/repo/.claude/evals/other.jsonl", "a", "b"));
});

const LEDGER = ".kore/state/ledger.jsonl";

it("append-only: Edit and Write on the ledger warn, naming the harness ledger tool as owner", async () => {
  for (const result of [
    await edit(`/repo/${LEDGER}`, "a", "b"),
    await write(`/repo/${LEDGER}`, "{}\n"),
  ]) {
    appendOnlyWarned(result, "ledger file tool");
    assert.match(result.message, /harness ledger/, "names the ledger tool");
  }
});

it("append-only: Bash that rewrites, truncates, moves, or removes the ledger warns", async () => {
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
    const result = await bash(command);
    appendOnlyWarned(result, command);
    assert.match(
      result.message,
      /harness ledger/,
      `${command}: names the tool`,
    );
  }
});

it("append-only: recording to and reading the ledger is allowed", async () => {
  for (const command of [
    `echo x >> ${LEDGER}`,
    `cat ${LEDGER}`,
    `tail -n 5 ${LEDGER}`,
    `grep stage ${LEDGER}`,
    `cp ${LEDGER} /tmp/backup.jsonl`,
    `node skills/bin/harness.mjs ledger record --source claude --stage build --kind start`,
    `node skills/bin/harness.mjs ledger list`,
  ]) {
    allowed(await bash(command));
  }
  allowed(await read(`/repo/${LEDGER}`));
});

it("append-only: a blocking rule in the same command still blocks", async () => {
  blocked(await bash(`rm ${HISTORY} && kubectl get pods`), "kubectl-context");
});
