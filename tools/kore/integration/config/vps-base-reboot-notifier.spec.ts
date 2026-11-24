import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { findRoot } from "../../src/config/index.js";

// Docs: docs/decisions/0153-rollback-goes-through-the-release-owner-and-host-maintenance-never-drains.md
// (only the kernel reboot waits; unattended-upgrades never reboots).

async function readRoot(path: string): Promise<string> {
  const root = await findRoot();
  return readFile(join(root, path), "utf8");
}

function taskBlock(tasks: string, name: string): string {
  const block = tasks.split(`- name: ${name}\n`)[1]?.split("\n- name:")[0];
  assert.ok(block, name);
  return block;
}

test("the base role installs reboot-notifier, so a kernel update writes the reboot sentinel the playbook reads", async () => {
  const tasks = await readRoot("infra/hosts/vps/roles/base/tasks/main.yaml");
  const install = taskBlock(tasks, "Install the base packages");
  assert.match(install, /^ {6}- reboot-notifier$/m);
});

test("the base role checks that the kernel hook which writes the reboot sentinel is in place, and skips that check in check mode, where the package is not yet installed", async () => {
  const tasks = await readRoot("infra/hosts/vps/roles/base/tasks/main.yaml");
  const probe = taskBlock(
    tasks,
    "Check that the kernel hook which writes the reboot sentinel is installed",
  );
  assert.match(probe, /ansible\.builtin\.stat:/);
  assert.match(
    probe,
    /^ {4}path: \/etc\/kernel\/postinst\.d\/reboot-notifier$/m,
  );
  assert.match(probe, /^ {2}check_mode: false$/m);

  const verify = taskBlock(
    tasks,
    "Fail when the kernel hook that writes the reboot sentinel is missing",
  );
  assert.match(verify, /ansible\.builtin\.assert:/);
  assert.match(verify, /base_reboot_hook\.stat\.islnk/);
  assert.match(verify, /^ {2}when: not ansible_check_mode$/m);
});

test("unattended-upgrades keeps installing and never reboots: the base role's apt settings set no automatic reboot", async () => {
  const autoUpgrades = await readRoot(
    "infra/hosts/vps/roles/base/files/20auto-upgrades",
  );
  assert.equal(
    autoUpgrades,
    [
      'APT::Periodic::Update-Package-Lists "1";',
      'APT::Periodic::Unattended-Upgrade "1";',
      "",
    ].join("\n"),
  );
  assert.doesNotMatch(autoUpgrades, /Automatic-Reboot/);
});
