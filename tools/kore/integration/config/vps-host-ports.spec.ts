import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { findRoot, loadRepository } from "../../src/config/index.js";

// Docs: docs/decisions/0160-vps-has-an-internal-gateway-on-the-tailnet-and-an-external-gateway-on-public-443.md

type PublishRule = {
  name: string;
  address: "public" | "tailnet";
  port: number;
  protocol: "tcp" | "udp";
  service: string;
  nodePort: number;
};

const ipv4Literal = /\b\d{1,3}(?:\.\d{1,3}){3}\b/;

async function readHost(path: string): Promise<string> {
  const root = await findRoot();
  return readFile(join(root, "infra/hosts/vps", path), "utf8");
}

async function portTable(): Promise<{ publish: PublishRule[] }> {
  const table: { publish: PublishRule[] } = JSON.parse(
    await readHost("port-table.yaml"),
  );
  return table;
}

/** The text of one task, from its name line to the next task. */
function task(tasks: string, name: string): string {
  const block = tasks.split(`- name: ${name}\n`)[1]?.split("\n- name:")[0];
  assert.ok(block, `task "${name}" exists`);
  return block;
}

test("the port table is one variable file that maps each published port to its node port, and the vps internal Gateway has no port 80", async () => {
  const { publish } = await portTable();
  assert.deepEqual(
    publish.map(({ name, address, port, protocol, service, nodePort }) => ({
      name,
      address,
      port,
      protocol,
      service,
      nodePort,
    })),
    [
      {
        name: "external-gateway-http",
        address: "public",
        port: 80,
        protocol: "tcp",
        service: "kore-gateway-external",
        nodePort: 30080,
      },
      {
        name: "external-gateway-https",
        address: "public",
        port: 443,
        protocol: "tcp",
        service: "kore-gateway-external",
        nodePort: 30444,
      },
      {
        name: "internal-gateway-https",
        address: "tailnet",
        port: 443,
        protocol: "tcp",
        service: "kore-gateway",
        nodePort: 30443,
      },
      {
        name: "platform-dns-udp",
        address: "tailnet",
        port: 53,
        protocol: "udp",
        service: "platform-dns",
        nodePort: 31053,
      },
      {
        name: "platform-dns-tcp",
        address: "tailnet",
        port: 53,
        protocol: "tcp",
        service: "platform-dns",
        nodePort: 31053,
      },
    ],
  );
  assert.equal(
    publish.some((rule) => rule.service === "kore-gateway" && rule.port === 80),
    false,
  );
});

test("only the external Gateway is published on the public address, and only on ports 80 and 443", async () => {
  const { publish } = await portTable();
  const publicRules = publish.filter((rule) => rule.address === "public");
  assert.ok(publicRules.length > 0);
  assert.deepEqual(
    [...new Set(publicRules.map((rule) => rule.service))],
    ["kore-gateway-external"],
  );
  assert.deepEqual(
    publicRules.map((rule) => rule.port).sort((a, b) => a - b),
    [80, 443],
  );
});

test("the port table's node ports appear in no file of the network or k3s roles or the playbook, so the table is the one copy", async () => {
  const numbers = /\b(?:30080|30444|30443|31053)\b/;
  for (const path of [
    "roles/network/defaults/main.yaml",
    "roles/network/tasks/main.yaml",
    "roles/network/templates/nftables.conf.j2",
    "roles/k3s/defaults/main.yaml",
    "roles/k3s/tasks/main.yaml",
    "roles/k3s/templates/kore-host-addresses.yaml.j2",
    "site.yaml",
  ]) {
    assert.doesNotMatch(await readHost(path), numbers, path);
  }
});

test("the network role renders its firewall from the port table and the host's addresses, and the table is loaded from the playbook's own directory", async () => {
  const defaults = await readHost("roles/network/defaults/main.yaml");
  assert.match(
    defaults,
    /^network_port_table: "\{\{ lookup\('ansible\.builtin\.file', playbook_dir ~ '\/port-table\.yaml'\) \| from_yaml \}\}"$/m,
  );
});

test("the firewall is written from the port table only while the host-published-ports flag is on, and otherwise today's firewall is written unchanged", async () => {
  const tasks = await readHost("roles/network/tasks/main.yaml");
  assert.match(
    tasks,
    /src: "\{\{ 'nftables\.conf\.j2' if kore_host_ports_flag \| bool else 'nftables\.conf' \}\}"/,
  );
  const current = await readHost("roles/network/templates/nftables.conf");
  assert.match(current, /^table inet kore_host \{$/m);
  assert.match(current, /chain input \{/);
  assert.doesNotMatch(current, /prerouting|forward|\{\{|\{%/);
});

test("the host-published-ports flag is declared in the vps overlay, off, and the playbook reads it from there", async () => {
  const { environment } = await loadRepository("vps");
  assert.equal(environment.features?.["host-published-ports"], false);
  const site = await readHost("site.yaml");
  assert.match(
    site,
    /kore_host_ports_flag: >-\n\s+\{\{ \(lookup\('ansible\.builtin\.file', playbook_dir ~ '\/\.\.\/\.\.\/environments\/vps\/environment\.yaml'\)\n\s+\| from_yaml\)\.features\['host-published-ports'\] \| default\(false\) \}\}/,
  );
});

test("the firewall template redirects each published port to its node port per address, before kube-proxy's own node-port rules run", async () => {
  const template = await readHost("roles/network/templates/nftables.conf.j2");
  assert.match(template, /table inet kore_host \{/);
  assert.match(template, /chain prerouting \{/);
  assert.match(
    template,
    /type nat hook prerouting priority -110; policy accept;/,
  );
  assert.match(
    template,
    /\{% for rule in network_port_table\.publish %\}\n\s+ip daddr \{\{ kore_host_addresses\[rule\.address\] \}\} \{\{ rule\.protocol \}\} dport \{\{ rule\.port \}\} redirect to :\{\{ rule\.nodePort \}\}\n\{% endfor %\}/,
  );
});

test("the forward path drops every node port on a non-tailnet interface except the external Gateway's, and never sets the forward policy to drop", async () => {
  const template = await readHost("roles/network/templates/nftables.conf.j2");
  const forward = template.split("chain forward {")[1]?.split("\n  }")[0];
  assert.ok(forward, "the kore_host table has a forward chain");
  assert.match(
    forward,
    /type filter hook forward priority filter; policy accept;/,
  );
  assert.match(forward, /iifname "tailscale0" accept/);
  assert.match(
    forward,
    /iifname != "tailscale0" meta l4proto \{ tcp, udp \} ct original proto-dst 30000-32767 ct original proto-dst != \{ \{\{ external_node_ports \| join\(', '\) \}\} \} drop/,
  );
  assert.match(
    template,
    /\{% set external_node_ports = network_port_table\.publish \| selectattr\('service', 'equalto', 'kore-gateway-external'\) \| map\(attribute='nodePort'\) \| unique \| list %\}/,
  );
});

test("the firewall still filters the input chain the same way and keeps the rollback timer that guards the first apply", async () => {
  const template = await readHost("roles/network/templates/nftables.conf.j2");
  assert.match(
    template,
    /chain input \{\n\s+type filter hook input priority filter; policy drop;/,
  );
  assert.match(template, /iifname "tailscale0" accept/);
  const tasks = await readHost("roles/network/tasks/main.yaml");
  assert.match(tasks, /validate: \/usr\/sbin\/nft -c -f %s/);
  assert.ok(
    tasks.indexOf("Arm the rollback timer") <
      tasks.indexOf("Load the firewall"),
  );
  assert.match(
    tasks,
    /systemd-run --unit=kore-firewall-rollback\n\s+--on-active=\{\{ network_firewall_rollback_seconds \}\}\n\s+\/usr\/sbin\/nft delete table inet kore_host/,
  );
});

test("the public and tailnet addresses come from host facts in the playbook, and no role or the playbook holds an address literal", async () => {
  const site = await readHost("site.yaml");
  assert.match(
    site,
    /kore_host_addresses:\n\s+public: "\{\{ ansible_facts\['default_ipv4'\]\['address'\] \}\}"\n\s+tailnet: "\{\{ ansible_facts\['tailscale0'\]\['ipv4'\]\['address'\] \}\}"/,
  );
  for (const path of [
    "site.yaml",
    "roles/network/defaults/main.yaml",
    "roles/network/tasks/main.yaml",
    "roles/network/templates/nftables.conf.j2",
    "roles/k3s/tasks/main.yaml",
    "roles/k3s/templates/kore-host-addresses.yaml.j2",
    "port-table.yaml",
  ]) {
    assert.doesNotMatch(await readHost(path), ipv4Literal, path);
  }
});

test("the host-address ConfigMap is a k3s auto-deploy manifest in kore-system, written from host facts after the node is Ready", async () => {
  const tasks = await readHost("roles/k3s/tasks/main.yaml");
  const publish = task(tasks, "Publish the host's addresses to the cluster");
  assert.match(
    publish,
    /dest: "\{\{ k3s_data_path \}\}\/k3s\/server\/manifests\/kore-host-addresses\.yaml"/,
  );
  assert.match(publish, /src: kore-host-addresses\.yaml\.j2/);
  assert.ok(
    tasks.indexOf("Wait for the node to be Ready") <
      tasks.indexOf("Publish the host's addresses to the cluster"),
  );
  const template = await readHost(
    "roles/k3s/templates/kore-host-addresses.yaml.j2",
  );
  assert.match(template, /^kind: ConfigMap$/m);
  assert.match(template, /^ {2}name: kore-host-addresses$/m);
  assert.match(template, /^ {2}namespace: kore-system$/m);
  assert.match(
    template,
    /^ {2}public: "\{\{ kore_host_addresses\.public \}\}"$/m,
  );
  assert.match(
    template,
    /^ {2}tailnet: "\{\{ kore_host_addresses\.tailnet \}\}"$/m,
  );
});

test("the task that writes the host-address ConfigMap suppresses its output, so no address reaches a log", async () => {
  const tasks = await readHost("roles/k3s/tasks/main.yaml");
  const publish = task(tasks, "Publish the host's addresses to the cluster");
  assert.match(publish, /^ {2}no_log: true$/m);
});

test("the ConfigMap and its directory are written only while the host-published-ports flag is on, so a flag-off run changes nothing on the node", async () => {
  const tasks = await readHost("roles/k3s/tasks/main.yaml");
  for (const name of [
    "Create the k3s auto-deploy directory",
    "Publish the host's addresses to the cluster",
  ]) {
    assert.match(
      task(tasks, name),
      /^ {2}when: kore_host_ports_flag \| bool$/m,
      name,
    );
  }
});

test("the flag-off firewall and the ConfigMap template hold no literal IPv4 address, so the host's own addresses come only from facts", async () => {
  for (const path of [
    "roles/network/templates/nftables.conf",
    "roles/k3s/templates/kore-host-addresses.yaml.j2",
  ]) {
    assert.doesNotMatch(await readHost(path), ipv4Literal, path);
  }
});
