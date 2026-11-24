import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { findRoot, flagEntry, loadRepository } from "../../src/config/index.js";

// Docs: docs/decisions/0168-the-openbao-static-seal-key-is-a-recorded-exception-to-no-plaintext-on-disk.md

async function readRoot(path: string): Promise<string> {
  const root = await findRoot();
  return readFile(join(root, path), "utf8");
}

async function readRole(path: string): Promise<string> {
  return readRoot(join("infra/hosts/vps/roles/openbao", path));
}

/** The text of one task, from its name line to the next task. */
function taskBlock(tasks: string, name: string): string {
  const block = tasks.split(`- name: ${name}\n`)[1]?.split("\n- name:")[0];
  assert.ok(block, `task "${name}" exists`);
  return block;
}

/** Every task of a task file, by name, in file order. */
function tasksOf(tasks: string): { name: string; text: string }[] {
  return ("\n" + tasks)
    .split("\n- name: ")
    .slice(1)
    .map((chunk) => {
      const [name = "", ...body] = chunk.split("\n");
      return { name, text: body.join("\n") };
    });
}

test("the openbao flag is one feature for the vps OpenBao component: off in every overlay, and applicable to vps alone", async () => {
  const { environment, flags } = await loadRepository("vps");
  const entry = flagEntry(flags, "openbao");
  assert.equal(entry?.name, "openbao");
  assert.equal(entry?.kind, "feature");
  assert.deepEqual(entry?.notApplicable, ["local", "managed-example"]);
  assert.equal(environment.features?.openbao, false);
  for (const name of ["local", "managed-example"]) {
    const other = await loadRepository(name);
    assert.equal(other.environment.features?.openbao, false, name);
  }
});

test("the openbao role runs on the vps host after k3s, so the key is placed once the node's cluster is converged", async () => {
  const site = await readRoot("infra/hosts/vps/site.yaml");
  const vps = site.split("- name: Converge the agents VM")[0] ?? "";
  assert.ok(vps.includes("    - openbao\n"), "the vps play lists openbao");
  assert.ok(vps.indexOf("    - openbao\n") > vps.indexOf("    - k3s\n"));
});

test("every task of the openbao role is gated by the openbao flag, so a flag-off run changes nothing", async () => {
  const tasks = tasksOf(await readRole("tasks/main.yaml"));
  assert.ok(tasks.length >= 8, "the role has its tasks");
  for (const task of tasks) {
    assert.match(task.text, /openbao_seal_enabled \| bool/, task.name);
  }
});

test("the role reads its flag from the vps overlay, defaults it off, and reads the controller's key from the home directory, never from the repository", async () => {
  const defaults = await readRole("defaults/main.yaml");
  assert.match(
    defaults,
    /^openbao_vps_environment: "\{\{ lookup\('ansible\.builtin\.file', playbook_dir ~ '\/\.\.\/\.\.\/environments\/vps\/environment\.yaml'\) \| from_yaml \}\}"$/m,
  );
  assert.match(
    defaults,
    /^openbao_seal_enabled: "\{\{ openbao_vps_environment\.features\['openbao'\] \| default\(false\) \}\}"$/m,
  );
  assert.match(
    defaults,
    /^openbao_seal_controller_key: "\{\{ lookup\('ansible\.builtin\.env', 'HOME'\) \}\}\/\.config\/kore\/openbao-static-seal\.key"$/m,
  );
});

test("the node's key is a root-only file under /etc, never under the k3s data path", async () => {
  const defaults = await readRole("defaults/main.yaml");
  assert.match(defaults, /^openbao_seal_key_dir: \/etc\/kore\/openbao$/m);
  assert.match(
    defaults,
    /^openbao_seal_key_path: \/etc\/kore\/openbao\/static-seal\.key$/m,
  );
  assert.doesNotMatch(defaults, /k3s_data_path|\/var\/lib\/rancher/);
});

test("a missing controller key stops the run with a message that names the command that creates it", async () => {
  const tasks = await readRole("tasks/main.yaml");
  const check = taskBlock(
    tasks,
    "Require the OpenBao seal key on the controller",
  );
  assert.match(check, /openbao_controller_key\.stat\.exists/);
  assert.match(check, /openssl rand -base64 32/);
  assert.match(check, /chmod 0400/);
  assert.match(check, /recovery kit/);
});

test("a key that does not decode to exactly 32 bytes is refused before anything is placed, and the check prints only a count", async () => {
  const tasks = await readRole("tasks/main.yaml");
  const measure = taskBlock(
    tasks,
    "Measure the controller key's decoded length",
  );
  assert.match(measure, /base64 -d/);
  assert.match(measure, /wc -c/);
  assert.match(measure, /pipefail/);
  assert.doesNotMatch(measure, /cat |lookup\(/);
  const check = taskBlock(
    tasks,
    "Require the controller key to decode to 32 bytes",
  );
  assert.match(check, /rc == 0/);
  assert.match(check, /stdout \| trim == "32"/);
  assert.ok(
    tasks.indexOf("- name: Require the controller key to decode to 32 bytes") <
      tasks.indexOf("- name: Place the OpenBao seal key through stdin"),
  );
});

test("the key reaches the node only through stdin of a command whose output is suppressed, never by copy, template, slurp, fetch, debug or a line edit", async () => {
  const tasks = await readRole("tasks/main.yaml");
  assert.doesNotMatch(
    tasks,
    /ansible\.builtin\.(copy|template|slurp|fetch|debug|lineinfile|blockinfile|assemble)\b/,
  );
  const place = taskBlock(tasks, "Place the OpenBao seal key through stdin");
  assert.match(place, /ansible\.builtin\.command:/);
  assert.match(
    place,
    /stdin: "\{\{ lookup\('ansible\.builtin\.file', openbao_seal_controller_key\) \| trim \}\}"/,
  );
  assert.match(place, /^ {4}stdin_add_newline: false$/m);
  assert.match(place, /^ {2}no_log: true$/m);
  assert.match(place, /noclobber/);
  assert.match(place, /umask 077/);
});

test("the key is placed only when none is on the node, and an existing key is never overwritten", async () => {
  const tasks = await readRole("tasks/main.yaml");
  const place = taskBlock(tasks, "Place the OpenBao seal key through stdin");
  assert.match(place, /openbao_seal_key_before\.stat\.exists/);
  assert.match(place, /not ansible_check_mode/);
  assert.match(place, /set -o noclobber/);
  const dirTasks = taskBlock(tasks, "Create the OpenBao seal key directory");
  assert.doesNotMatch(dirTasks, /openbao_seal_key_path/);
});

test("the key's value is never printed: the task that reads its SHA-256 and the placement are no_log", async () => {
  const tasks = await readRole("tasks/main.yaml");
  for (const name of [
    "Read the controller key's SHA-256 without printing it",
    "Place the OpenBao seal key through stdin",
    "Stat the OpenBao seal key on the node",
    "Stat the OpenBao seal key on the node after placement",
  ]) {
    assert.match(taskBlock(tasks, name), /^ {2}no_log: true$/m, name);
  }
});

test("after every apply the key's mode, owner, group, location and content are checked, and a drift fails the run", async () => {
  const tasks = await readRole("tasks/main.yaml");
  const check = taskBlock(
    tasks,
    "Require the OpenBao seal key to match its contract",
  );
  assert.match(check, /openbao_seal_key\.stat\.mode == "0400"/);
  assert.match(check, /openbao_seal_key\.stat\.pw_name == "root"/);
  assert.match(check, /openbao_seal_key\.stat\.gr_name == "root"/);
  assert.match(
    check,
    /openbao_seal_key\.stat\.dev == openbao_root_fs\.stat\.dev/,
  );
  assert.match(
    check,
    /openbao_seal_key\.stat\.checksum == openbao_seal_key_sha256/,
  );
});

test("the seal key directory is checked on the root filesystem and as root-only, and a drifted directory fails the run", async () => {
  const tasks = await readRole("tasks/main.yaml");
  const check = taskBlock(
    tasks,
    "Require the OpenBao seal key directory to match its contract",
  );
  assert.match(check, /openbao_seal_dir\.stat\.mode == "0700"/);
  assert.match(
    check,
    /openbao_seal_dir\.stat\.dev == openbao_root_fs\.stat\.dev/,
  );
});

test("the role holds no key value and no address literal", async () => {
  const ipv4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/;
  const base64Key = /[A-Za-z0-9+/]{40,}={0,2}/;
  for (const path of ["defaults/main.yaml", "tasks/main.yaml"]) {
    const text = await readRole(path);
    assert.doesNotMatch(text, ipv4, path);
    assert.doesNotMatch(text, base64Key, path);
  }
});
