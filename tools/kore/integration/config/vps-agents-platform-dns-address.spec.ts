import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { findRoot } from "../../src/config/index.js";

// Docs: docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md

async function readRoot(path: string): Promise<string> {
  const root = await findRoot();
  return readFile(join(root, path), "utf8");
}

function section(unit: string, name: string): string {
  const body = unit.split(`[${name}]\n`)[1]?.split(/^\[/m)[0];
  assert.ok(body, name);
  return body;
}

test("the platform DNS link gets a /128 from the private ULA prefix, so systemd-resolved opens a DNS scope on it", async () => {
  const defaults = await readRoot(
    "infra/hosts/vps/roles/agents/defaults/main.yaml",
  );
  assert.match(
    defaults,
    /^agents_platform_dns_link_address: "fd4b:6f72:6500::1\/128"$/m,
  );
});

test("the link's network unit assigns that address in [Network], and nowhere else", async () => {
  const unit = await readRoot(
    "infra/hosts/vps/roles/agents/templates/kore-platform-dns.network.j2",
  );
  const network = section(unit, "Network");
  assert.deepEqual(
    network.split("\n").filter((line) => line.startsWith("Address=")),
    ["Address={{ agents_platform_dns_link_address }}"],
  );
  assert.doesNotMatch(section(unit, "Match"), /Address=/);
});

test("the netdev template no longer claims the link has no address", async () => {
  const netdev = await readRoot(
    "infra/hosts/vps/roles/agents/templates/kore-platform-dns.netdev.j2",
  );
  assert.doesNotMatch(netdev, /It has no address/);
});
