import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { findRoot } from "../../src/config/index.js";

// Docs: docs/decisions/0141-the-vps-host-is-converged-by-an-ansible-playbook-in-the-repository.md

async function readRoot(path: string): Promise<string> {
  const root = await findRoot();
  return readFile(join(root, path), "utf8");
}

function taskBlock(tasks: string, name: string): string {
  const block = tasks.split(`- name: ${name}\n`)[1]?.split("\n- name:")[0];
  assert.ok(block, name);
  return block;
}

test("the agents role pins mkcert to the version .mise.toml pins, so the agent's mkcert is the repository's", async () => {
  const defaults = await readRoot(
    "infra/hosts/vps/roles/agents/defaults/main.yaml",
  );
  const mise = await readRoot(".mise.toml");
  assert.match(defaults, /^  mkcert: "1\.4\.4"$/m);
  assert.match(mise, /^mkcert = "1\.4\.4"$/m);
});

test("the agent's mkcert CA lives in the agent's home, owned by the agent and private to it, and is created before anything writes into it", async () => {
  const tasks = await readRoot("infra/hosts/vps/roles/agents/tasks/main.yaml");
  assert.equal(
    taskBlock(tasks, "Create the agent's mkcert CA directory"),
    [
      "  ansible.builtin.file:",
      '    path: "/home/{{ agents_user }}/.local/share/mkcert"',
      "    state: directory",
      '    owner: "{{ agents_user }}"',
      '    group: "{{ agents_user }}"',
      '    mode: "0700"',
      "",
    ].join("\n"),
  );
});

test("the pinned mkcert creates the agent's CA and installs it in the system store as root, with only the system store enabled and CAROOT in the agent's home", async () => {
  const tasks = await readRoot("infra/hosts/vps/roles/agents/tasks/main.yaml");
  assert.equal(
    taskBlock(
      tasks,
      "Create the agent's local CA and trust it in the system store",
    ),
    [
      "  ansible.builtin.command:",
      "    argv:",
      '      - "/home/{{ agents_user }}/.local/share/mise/installs/mkcert/{{ agents_tools.mkcert }}/mkcert"',
      "      - -install",
      "  environment:",
      '    CAROOT: "/home/{{ agents_user }}/.local/share/mkcert"',
      "    TRUST_STORES: system",
      "  register: agents_mkcert_install",
      "  changed_when: \"'now installed in the system trust store' in agents_mkcert_install.stderr\"",
      "  when: not ansible_check_mode",
      "",
    ].join("\n"),
  );
});

test("the root run happens after the agent's tools are installed, so the pinned mkcert is on disk when it runs", async () => {
  const tasks = await readRoot("infra/hosts/vps/roles/agents/tasks/main.yaml");
  const tools = tasks.indexOf("- name: Install the agent's tools\n");
  const root = tasks.indexOf(
    "- name: Create the agent's local CA and trust it in the system store\n",
  );
  assert.ok(tools >= 0, "Install the agent's tools");
  assert.ok(root > tools, "the CA run comes after the tools install");
});

test("the agent receives its CA certificate and key as its own files, the key at mode 0600, and neither is fetched or copied to the controller", async () => {
  const tasks = await readRoot("infra/hosts/vps/roles/agents/tasks/main.yaml");
  assert.equal(
    taskBlock(tasks, "Hand the agent's mkcert CA key to the agent"),
    [
      "  ansible.builtin.file:",
      '    path: "/home/{{ agents_user }}/.local/share/mkcert/rootCA-key.pem"',
      '    owner: "{{ agents_user }}"',
      '    group: "{{ agents_user }}"',
      '    mode: "0600"',
      "  when: not ansible_check_mode",
      "",
    ].join("\n"),
  );
  assert.equal(
    taskBlock(tasks, "Hand the agent's mkcert CA certificate to the agent"),
    [
      "  ansible.builtin.file:",
      '    path: "/home/{{ agents_user }}/.local/share/mkcert/rootCA.pem"',
      '    owner: "{{ agents_user }}"',
      '    group: "{{ agents_user }}"',
      '    mode: "0644"',
      "  when: not ansible_check_mode",
      "",
    ].join("\n"),
  );
  assert.doesNotMatch(tasks, /ansible\.builtin\.(fetch|slurp)[\s\S]*mkcert/);
});

// Loopback (127.0.0.0/8) is allowed: the platform DNS listens on 127.0.0.1 by design.
// Any other IPv4 address is a public or private one, and must not appear in the role.
const nonLoopbackIpv4 = /\b(?!127\.)\d{1,3}(\.\d{1,3}){3}\b/;

test("the agents role holds no key material, public address or domain; loopback is allowed", async () => {
  const role = [
    await readRoot("infra/hosts/vps/roles/agents/defaults/main.yaml"),
    await readRoot("infra/hosts/vps/roles/agents/tasks/main.yaml"),
  ].join("\n");
  assert.doesNotMatch(role, /PRIVATE KEY|BEGIN /);
  assert.doesNotMatch(role, nonLoopbackIpv4);
});

test("the address guard still catches a non-loopback IPv4 address, and lets 127.0.0.0/8 through", () => {
  assert.match("agents_address: 203.0.113.7", nonLoopbackIpv4);
  assert.match("agents_address: 10.0.0.1", nonLoopbackIpv4);
  assert.doesNotMatch(
    "agents_platform_dns_address: 127.0.0.1",
    nonLoopbackIpv4,
  );
});
