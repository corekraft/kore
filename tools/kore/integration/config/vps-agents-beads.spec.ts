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

const tasksPath = "infra/hosts/vps/roles/agents/tasks/main.yaml";

test("the agents role pins bd to an exact release and the checksum of its linux amd64 tarball", async () => {
  const defaults = await readRoot(
    "infra/hosts/vps/roles/agents/defaults/main.yaml",
  );
  assert.match(defaults, /^agents_beads_version: "1\.3\.4"$/m);
  assert.match(
    defaults,
    /^agents_beads_sha256: "175c26904bde3ff9168d2282ff6b56f17b17f60c22fa5acb3dacc9fb3465303a"$/m,
  );
});

test("bd is downloaded from its pinned GitHub release and refused unless the checksum matches", async () => {
  const tasks = await readRoot(tasksPath);
  assert.equal(
    taskBlock(tasks, "Download the pinned bd"),
    [
      "  register: agents_beads_download",
      "  ansible.builtin.get_url:",
      '    url: "https://github.com/steveyegge/beads/releases/download/v{{ agents_beads_version }}/beads_{{ agents_beads_version }}_linux_amd64.tar.gz"',
      '    dest: "/var/cache/beads-{{ agents_beads_version }}.tar.gz"',
      '    checksum: "sha256:{{ agents_beads_sha256 }}"',
      "    owner: root",
      "    group: root",
      '    mode: "0644"',
      "",
    ].join("\n"),
  );
});

test("only the bd binary is unpacked, into the agent's local bin and owned by the agent, and a check run that downloaded nothing skips it", async () => {
  const tasks = await readRoot(tasksPath);
  assert.equal(
    taskBlock(tasks, "Install bd"),
    [
      "  ansible.builtin.unarchive:",
      '    src: "/var/cache/beads-{{ agents_beads_version }}.tar.gz"',
      '    dest: "/home/{{ agents_user }}/.local/bin"',
      "    remote_src: true",
      "    include:",
      "      - bd",
      '    owner: "{{ agents_user }}"',
      '    group: "{{ agents_user }}"',
      '    mode: "0755"',
      "  # A check run downloads nothing, so there is no tarball to unpack yet.",
      "  when: not (ansible_check_mode and agents_beads_download.changed)",
      "",
    ].join("\n"),
  );
});

test("bd is installed after the agent's local bin directory exists", async () => {
  const tasks = await readRoot(tasksPath);
  const bin = tasks.indexOf("- name: Create the agent's local bin directory\n");
  const install = tasks.indexOf("- name: Install bd\n");
  assert.ok(bin >= 0 && install > bin);
});
