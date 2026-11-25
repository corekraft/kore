import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { findRoot, loadRepository } from "../../src/config/index.js";

// Docs: docs/decisions/0142-the-vps-environment-targets-the-persistent-k3s-node-as-a-managed-cluster.md
// and docs/decisions/0151-host-and-k3s-changes-follow-the-same-safety-patterns-and-run-in-a-maintenance-window.md

async function readRoot(path: string): Promise<string> {
  const root = await findRoot();
  return readFile(join(root, path), "utf8");
}

async function readRole(path: string): Promise<string> {
  return readRoot(join("infra/hosts/vps/roles/k3s", path));
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

/** The registry trust tasks: from the kubeconfig look-up to the k3s drop-in directory. */
function registryTasks(tasks: string): { name: string; text: string }[] {
  const start = tasks.indexOf("- name: Look for the controller's kubeconfig\n");
  const end = tasks.indexOf(
    "- name: Create the k3s service drop-in directory\n",
  );
  assert.ok(
    start >= 0 && end > start,
    "the registry trust tasks are bracketed",
  );
  return tasksOf(tasks.slice(start, end));
}

test("the k3s registries file trusts the registry's CA by file and names no mirror, endpoint or insecure setting", async () => {
  assert.equal(
    await readRole("templates/registries.yaml.j2"),
    [
      "# Managed by infra/hosts/vps (Ansible). Edits here are overwritten.",
      "# Only the registry's public CA is trusted; no mirror or endpoint is added",
      "# and verification is never skipped.",
      "configs:",
      "  {{ k3s_registry_address | to_json }}:",
      "    tls:",
      "      ca_file: {{ k3s_registry_ca_path }}",
      "",
    ].join("\n"),
  );
});

test("the registry address and the k3s-registry-trust flag come from the vps environment overlay, so the role holds no second copy of either", async () => {
  const defaults = await readRole("defaults/main.yaml");
  assert.match(
    defaults,
    /^k3s_vps_environment: "\{\{ lookup\('ansible\.builtin\.file', playbook_dir ~ '\/\.\.\/\.\.\/environments\/vps\/environment\.yaml'\) \| from_yaml \}\}"$/m,
  );
  assert.match(
    defaults,
    /^k3s_registry_address: "\{\{ k3s_vps_environment\.registry\.address \}\}"$/m,
  );
  assert.match(
    defaults,
    /^k3s_registry_trust: "\{\{ k3s_vps_environment\.features\['k3s-registry-trust'\] \| default\(false\) \}\}"$/m,
  );
  for (const path of [
    "defaults/main.yaml",
    "tasks/main.yaml",
    "templates/registries.yaml.j2",
  ]) {
    assert.doesNotMatch(await readRole(path), /10\.43\.0\.50/, path);
  }
});

test("k3s-registry-trust is listed and off in vps and managed-example until a live run on kore-vps and harness flag activate turn it on, and absent from local, which the manifest does not apply it to", async () => {
  for (const name of ["managed-example", "vps"]) {
    const { environment } = await loadRepository(name);
    assert.equal(environment.features?.["k3s-registry-trust"], false, name);
  }
  const local = await loadRepository("local");
  assert.equal(local.environment.features?.["k3s-registry-trust"], undefined);
});

test("the registry CA is read from the TLS Secret kore names, so the role copies only those two constants and no path on the controller", async () => {
  const defaults = await readRole("defaults/main.yaml");
  assert.match(defaults, /^k3s_registry_namespace: kore-registry$/m);
  assert.match(defaults, /^k3s_registry_secret_name: oci-registry-tls$/m);
  const secret = await readRoot("tools/kore/src/images/registry-tls.ts");
  assert.match(secret, /export const registryTlsSecret = "oci-registry-tls";/);
  const auth = await readRoot("tools/kore/src/images/registry-auth.ts");
  assert.match(auth, /export const registryNamespace = "kore-registry";/);
});

test("the registry CA is never exported by hand: the role names no controller file for it, and no task or message names an export command", async () => {
  const defaults = await readRole("defaults/main.yaml");
  const tasks = await readRole("tasks/main.yaml");
  assert.doesNotMatch(defaults, /k3s_registry_ca_source|kore-vps-registry-ca/);
  assert.doesNotMatch(tasks, /k3s_registry_ca_source|kore-vps-registry-ca/);
  assert.doesNotMatch(tasks, /--output=(json|yaml)\b/);
  assert.doesNotMatch(tasks, /configmap|export (the|only|its)/);
  for (const task of registryTasks(tasks)) {
    assert.doesNotMatch(task.text, /slurp/, task.name);
  }
});

test("the role reads only the ca.crt key of the registry Secret, through the controller's kubeconfig and the kore-vps context, and never the Secret's key", async () => {
  const defaults = await readRole("defaults/main.yaml");
  assert.match(
    defaults,
    /^k3s_controller_kubeconfig: ~\/\.kube\/kore-vps\.yaml$/m,
  );
  assert.match(defaults, /^k3s_context: kore-vps$/m);
  const tasks = await readRole("tasks/main.yaml");
  const read = taskBlock(
    tasks,
    "Read the registry's public CA from the cluster",
  );
  assert.match(read, /^ {6}- '--output=jsonpath=\{\.data\.ca\\\.crt\}'$/m);
  assert.match(read, /^ {6}- "--context=\{\{ k3s_context \}\}"$/m);
  assert.match(read, /^ {2}delegate_to: localhost$/m);
  assert.match(read, /^ {2}become: false$/m);
  assert.match(read, /^ {2}check_mode: false$/m);
  assert.match(read, /^ {2}changed_when: false$/m);
  // Every jsonpath the registry tasks ask for is ca.crt alone; no output dumps the whole Secret.
  const registry = registryTasks(tasks)
    .map((t) => t.text)
    .join("\n");
  const paths = [...registry.matchAll(/jsonpath=([^\n']+)/g)].map((m) => m[1]);
  assert.deepEqual(paths, ["{.data.ca\\.crt}"]);
  assert.doesNotMatch(registry, /--output=(json|yaml)\b|\.data\.tls/);
});

test("the Secret look-up asks for the name only with --ignore-not-found, so an absent Secret reads as empty rather than as a failure", async () => {
  const tasks = await readRole("tasks/main.yaml");
  const look = taskBlock(
    tasks,
    "Look for the registry's TLS Secret on the cluster",
  );
  assert.match(look, /^ {6}- --ignore-not-found$/m);
  assert.match(look, /^ {6}- --output=name$/m);
  assert.match(look, /^ {2}changed_when: false$/m);
  assert.match(look, /^ {2}check_mode: false$/m);
});

test("with the flag on and the Secret absent, the registry task skips and says the registry is not deployed yet, and the run does not fail", async () => {
  const tasks = await readRole("tasks/main.yaml");
  const note = taskBlock(tasks, "Note whether the registry is deployed yet");
  assert.match(
    note,
    /k3s_registry_deployed: "\{\{ \(k3s_registry_secret\.stdout \| default\(''\)\) \| trim != '' \}\}"/,
  );
  const say = taskBlock(tasks, "Say the registry is not deployed yet");
  assert.match(say, /ansible\.builtin\.debug:/);
  assert.match(say, /the registry is not deployed yet/);
  assert.match(
    say,
    /^ {2}when: k3s_registry_trust \| bool and not k3s_registry_deployed \| bool$/m,
  );
  assert.doesNotMatch(say, /assert|fail/);
});

test("every registry trust task is gated by the flag, and the ones that touch the CA also by the Secret being deployed, so a flag-off run changes nothing", async () => {
  const tasks = await readRole("tasks/main.yaml");
  const block = registryTasks(tasks);
  assert.equal(block.length, 8, "the registry block has its eight tasks");
  for (const task of block) {
    assert.match(task.text, /k3s_registry_trust \| bool/, task.name);
  }
  for (const name of [
    "Read the registry's public CA from the cluster",
    "Refuse a registry CA that is not a bare certificate",
    "Install the registry's public CA on the node",
    "Trust the registry's CA in k3s",
  ]) {
    assert.match(
      taskBlock(tasks, name),
      /^ {2}when: k3s_registry_trust \| bool and k3s_registry_deployed \| bool$/m,
      name,
    );
  }
  assert.match(
    taskBlock(tasks, "Look for the registry's TLS Secret on the cluster"),
    /^ {2}when: k3s_registry_trust \| bool and k3s_controller_kubeconfig_stat\.stat\.exists$/m,
  );
});

test("a registry CA holding a private key, or no certificate, is refused before anything is written to the node", async () => {
  const tasks = await readRole("tasks/main.yaml");
  const refuse = taskBlock(
    tasks,
    "Refuse a registry CA that is not a bare certificate",
  );
  assert.match(refuse, /ansible\.builtin\.assert:\n {4}that:\n/);
  assert.match(refuse, /'-----BEGIN CERTIFICATE-----' in k3s_registry_ca_pem/);
  assert.match(refuse, /'PRIVATE KEY' not in k3s_registry_ca_pem/);
  assert.match(
    refuse,
    /k3s_registry_ca_pem: "\{\{ k3s_registry_ca_read\.stdout \| b64decode \}\}"/,
  );
  assert.ok(
    tasks.indexOf(
      "- name: Refuse a registry CA that is not a bare certificate",
    ) < tasks.indexOf("- name: Install the registry's public CA on the node"),
  );
});

test("the node gets the CA at a world-readable path and the registries file, and each notifies the existing Restart k3s handler, so k3s restarts only when one changed", async () => {
  const tasks = await readRole("tasks/main.yaml");
  const install = taskBlock(
    tasks,
    "Install the registry's public CA on the node",
  );
  assert.match(install, /dest: "\{\{ k3s_registry_ca_path \}\}"/);
  assert.match(
    install,
    /content: "\{\{ k3s_registry_ca_read\.stdout \| b64decode \}\}"/,
  );
  assert.match(install, /mode: "0644"/);
  assert.match(install, /notify: Restart k3s/);
  const trust = taskBlock(tasks, "Trust the registry's CA in k3s");
  assert.match(trust, /src: registries\.yaml\.j2/);
  assert.match(trust, /dest: \/etc\/rancher\/k3s\/registries\.yaml/);
  assert.match(trust, /notify: Restart k3s/);
  assert.doesNotMatch(tasks, /state: restarted/);
  const handlers = await readRole("handlers/main.yaml");
  assert.match(handlers, /^- name: Restart k3s$/m);
  const flush = tasks.indexOf("ansible.builtin.meta: flush_handlers");
  assert.ok(tasks.indexOf("- name: Trust the registry's CA in k3s") < flush);
  assert.ok(
    tasks.indexOf("- name: Install the registry's public CA on the node") <
      flush,
  );
});

test("the by-hand export is gone from the host README, the rebuild steps, the registry notes and ADR 0142, which now describes the role reading the Secret", async () => {
  const readme = await readRoot("infra/hosts/vps/README.md");
  const rebuild = await readRoot("docs/operations/rebuild-the-box.md");
  const registry = await readRoot("docs/operations/registry.md");
  const adr = await readRoot(
    "docs/decisions/0142-the-vps-environment-targets-the-persistent-k3s-node-as-a-managed-cluster.md",
  );
  for (const [name, text] of [
    ["host README", readme],
    ["rebuild-the-box", rebuild],
    ["registry", registry],
    ["ADR 0142", adr],
  ] as const) {
    assert.doesNotMatch(
      text,
      /kore-vps-registry-ca|configmap kore-registry-ca/,
      name,
    );
    assert.doesNotMatch(text, /export the CA|Copy the registry CA/, name);
  }
  assert.doesNotMatch(rebuild, /registry CA copy/);
  assert.doesNotMatch(registry, /That is a by-hand step/);
  assert.doesNotMatch(adr, /to the controller at|controller at `~/);
  assert.match(
    adr,
    /reads the registry's public `ca\.crt`[^]*?from the TLS Secret `kore-registry\/oci-registry-tls`/,
  );
});
