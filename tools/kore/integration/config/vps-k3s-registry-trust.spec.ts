import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { findRoot, loadRepository } from "../../src/config/index.js";

// Docs: docs/decisions/0142-the-vps-environment-targets-the-persistent-k3s-node-as-a-managed-cluster.md

async function readRole(path: string): Promise<string> {
  const root = await findRoot();
  return readFile(join(root, "infra/hosts/vps/roles/k3s", path), "utf8");
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

test("k3s-registry-trust is listed and off in every overlay until a live run on kore-vps and harness flag activate turn it on", async () => {
  for (const name of ["local", "managed-example", "vps"]) {
    const { environment } = await loadRepository(name);
    assert.equal(environment.features?.["k3s-registry-trust"], false, name);
  }
});

test("the registry trust is skipped unless the flag is on, and with it on a missing CA file stops the run naming the export command", async () => {
  const defaults = await readRole("defaults/main.yaml");
  assert.match(
    defaults,
    /^k3s_registry_ca_source: ~\/\.kube\/kore-vps-registry-ca\.crt$/m,
  );
  const tasks = await readRole("tasks/main.yaml");
  for (const task of [
    "Look for the registry's public CA on the controller",
    "Require the registry's public CA on the controller",
    "Read the registry's public CA",
    "Refuse a registry CA file that is not a bare certificate",
    "Install the registry's public CA on the node",
    "Trust the registry's CA in k3s",
  ]) {
    const block = tasks.split(`- name: ${task}\n`)[1]?.split("\n- name:")[0];
    assert.ok(block, task);
    assert.match(block, /when: k3s_registry_trust \| bool/, task);
  }
  const require = tasks
    .split("- name: Require the registry's public CA on the controller\n")[1]
    ?.split("\n- name:")[0];
  assert.ok(require);
  assert.match(require, /that: k3s_registry_ca_stat\.stat\.exists/);
  assert.match(
    require,
    /kubectl --context kore-vps -n cosign-system get\s+configmap kore-registry-ca/,
  );
});

test("a registry CA file holding a private key or no certificate is refused before anything is written to the node", async () => {
  const tasks = await readRole("tasks/main.yaml");
  const refuse = tasks
    .split(
      "- name: Refuse a registry CA file that is not a bare certificate\n",
    )[1]
    ?.split("\n- name:")[0];
  assert.ok(refuse);
  assert.match(refuse, /ansible\.builtin\.assert:\n    that:\n/);
  assert.match(refuse, /'-----BEGIN CERTIFICATE-----' in k3s_registry_ca_pem/);
  assert.match(refuse, /'PRIVATE KEY' not in k3s_registry_ca_pem/);
  assert.ok(
    tasks.indexOf("Refuse a registry CA file") <
      tasks.indexOf("Install the registry's public CA on the node"),
  );
});

test("the node gets the CA at a world-readable path and the registries file, and each restarts k3s through the existing handler before the readiness wait", async () => {
  const tasks = await readRole("tasks/main.yaml");
  const install = tasks
    .split("- name: Install the registry's public CA on the node\n")[1]
    ?.split("\n- name:")[0];
  assert.ok(install);
  assert.match(install, /dest: "\{\{ k3s_registry_ca_path \}\}"/);
  assert.match(
    install,
    /content: "\{\{ k3s_registry_ca_slurp\.content \| b64decode \}\}"/,
  );
  assert.match(install, /mode: "0644"/);
  assert.match(install, /notify: Restart k3s/);
  const trust = tasks
    .split("- name: Trust the registry's CA in k3s\n")[1]
    ?.split("\n- name:")[0];
  assert.ok(trust);
  assert.match(trust, /src: registries\.yaml\.j2/);
  assert.match(trust, /dest: \/etc\/rancher\/k3s\/registries\.yaml/);
  assert.match(trust, /notify: Restart k3s/);
  const flush = tasks.indexOf("ansible.builtin.meta: flush_handlers");
  assert.ok(tasks.indexOf("Trust the registry's CA in k3s") < flush);
  assert.ok(
    tasks.indexOf("Install the registry's public CA on the node") < flush,
  );
});
