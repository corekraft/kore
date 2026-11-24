// Docs: docs/decisions/0163-one-cloudflare-zone-holds-the-platform-domain-opentofu-owns-fixed-records-and-external-dns-owns-route-records.md, docs/decisions/0164-the-platform-domain-is-a-run-time-value-and-the-repository-holds-a-placeholder.md

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { findRoot } from "../../src/config/index.js";

// Offline proof of the platform zone stack (ADR 0163): what it imports and
// protects, which records it owns, and that it writes no token and no real
// name. It reads the stack's files and never runs tofu or reaches Cloudflare.
// The generic pins, backend and credential checks run for every stack in
// tofu-stack.spec.ts.

const root = await findRoot();
const stackDirectory = join(root, "infra/tofu/stacks/cloudflare");

interface Block {
  kind: string;
  labels: readonly string[];
  body: string;
}

const declaration =
  /^(resource|data|variable|output|terraform) ((?:"[^"]*" ?)*)\{/gm;

/** Every top-level block of a file set, with its keyword, quoted labels and body. */
function blocks(text: string): Block[] {
  return [...text.matchAll(declaration)].map((match) => {
    const start = (match.index ?? 0) + match[0].length;
    let depth = 1;
    let end = start;
    while (depth > 0 && end < text.length) {
      if (text[end] === "{") {
        depth += 1;
      } else if (text[end] === "}") {
        depth -= 1;
      }
      end += 1;
    }
    return {
      kind: match[1] ?? "",
      labels: [...(match[2] ?? "").matchAll(/"([^"]*)"/g)].map(
        (label) => label[1] ?? "",
      ),
      body: text.slice(start, end - 1),
    };
  });
}

/** The raw HCL text of one attribute of a block body, or undefined when it is absent. */
function attribute(body: string, name: string): string | undefined {
  const match = new RegExp(`^\\s*${name}\\s*=\\s*(.+?)\\s*$`, "m").exec(body);
  return match?.[1];
}

/** A resource's name, the second label of a resource block. */
function nameOf(block: Block): string {
  return block.labels[1] ?? "";
}

/** A quoted HCL string's value, without its quotes. */
function unquoted(raw: string | undefined): string | undefined {
  return raw?.replace(/^"/, "").replace(/"$/, "");
}

async function stackFiles(): Promise<Record<string, string>> {
  const names = (await readdir(stackDirectory))
    .filter((name) => name.endsWith(".tf"))
    .sort();
  const entries = await Promise.all(
    names.map(
      async (name) =>
        [name, await readFile(join(stackDirectory, name), "utf8")] as const,
    ),
  );
  return Object.fromEntries(entries);
}

async function configuration(): Promise<string> {
  return Object.values(await stackFiles()).join("\n");
}

async function readme(): Promise<string> {
  return readFile(join(stackDirectory, "README.md"), "utf8");
}

async function resources(type: string): Promise<Block[]> {
  return blocks(await configuration()).filter(
    (block) => block.kind === "resource" && block.labels[0] === type,
  );
}

test("the stack declares exactly the three run-time values, and none of them has a default", async () => {
  const variables = blocks(await configuration()).filter(
    (block) => block.kind === "variable",
  );
  assert.deepEqual(
    variables
      .map((block) => block.labels[0] ?? "")
      .sort((a, b) => a.localeCompare(b)),
    ["cloudflare_account_id", "platform_domain", "public_ipv4"],
  );
  for (const variable of variables) {
    assert.doesNotMatch(
      variable.body,
      /^\s*default\s*=/m,
      `${variable.labels[0]} must have no default; the run-time value supplies it`,
    );
  }
});

test("the zone is imported under the platform domain's name and carries prevent_destroy, so a plan never deletes the registered zone", async () => {
  const zones = await resources("cloudflare_zone");
  assert.deepEqual(
    zones.map((zone) => zone.labels[1]),
    ["platform"],
    "exactly one zone resource, named platform",
  );
  const [zone] = zones;
  assert.ok(zone);
  assert.equal(attribute(zone.body, "name"), "var.platform_domain");
  assert.match(zone.body, /id\s*=\s*var\.cloudflare_account_id/);
  assert.match(
    zone.body,
    /lifecycle\s*\{[^}]*prevent_destroy\s*=\s*true[^}]*\}/,
  );
});

test("no resource or data source names a token, so no token value enters the local state", async () => {
  const names = blocks(await configuration())
    .filter((block) => block.kind === "resource" || block.kind === "data")
    .map((block) => block.labels[0] ?? "")
    .filter((label) => /token/i.test(label));
  assert.deepEqual(names, []);
});

test("every DNS record is one of the owned A, MX, TXT or CAA records, with a 300-second TTL, proxy off and the imported zone", async () => {
  const records = await resources("cloudflare_dns_record");
  for (const record of records) {
    const type = unquoted(attribute(record.body, "type"));
    assert.ok(
      ["A", "MX", "TXT", "CAA"].includes(type ?? ""),
      `${nameOf(record)} has type ${type}, which the zone stack never owns`,
    );
    assert.equal(attribute(record.body, "ttl"), "300", nameOf(record));
    assert.equal(attribute(record.body, "proxied"), "false", nameOf(record));
    assert.equal(
      attribute(record.body, "zone_id"),
      "cloudflare_zone.platform.id",
      nameOf(record),
    );
  }
  assert.deepEqual(
    records
      .map(
        (record) =>
          `${unquoted(attribute(record.body, "type"))} ${unquoted(attribute(record.body, "name"))}`,
      )
      .sort(),
    ["A @", "CAA @", "CAA @", "MX @", "TXT @", "TXT _dmarc"],
  );
});

test("the stack writes no AAAA record, because every record is IPv4 until an IPv6 change is proven", async () => {
  assert.doesNotMatch(await configuration(), /"AAAA"/);
});

test("the apex address record points at the run-time public address", async () => {
  const address = (await resources("cloudflare_dns_record")).find(
    (record) => unquoted(attribute(record.body, "type")) === "A",
  );
  assert.ok(address);
  assert.equal(unquoted(attribute(address.body, "name")), "@");
  assert.equal(attribute(address.body, "content"), "var.public_ipv4");
});

test("CAA allows only Let's Encrypt for issue and issuewild, with flags 0", async () => {
  const caa = (await resources("cloudflare_dns_record")).filter(
    (record) => unquoted(attribute(record.body, "type")) === "CAA",
  );
  assert.deepEqual(
    caa.map((record) => [
      /\btag\s*=\s*"([^"]*)"/.exec(record.body)?.[1],
      /\bvalue\s*=\s*"([^"]*)"/.exec(record.body)?.[1],
      /\bflags\s*=\s*(\S+)/.exec(record.body)?.[1],
    ]),
    [
      ["issue", "letsencrypt.org", "0"],
      ["issuewild", "letsencrypt.org", "0"],
    ],
  );
});

test("the anti-spoofing mail set is a null MX, SPF that rejects all, and DMARC reject, until a mail provider is chosen", async () => {
  const records = await resources("cloudflare_dns_record");
  const content = (type: string, name: string) =>
    records
      .filter(
        (record) =>
          unquoted(attribute(record.body, "type")) === type &&
          unquoted(attribute(record.body, "name")) === name,
      )
      .map((record) => [
        unquoted(attribute(record.body, "content")),
        attribute(record.body, "priority"),
      ]);
  assert.deepEqual(content("MX", "@"), [[".", "0"]]);
  assert.deepEqual(content("TXT", "@"), [["v=spf1 -all", undefined]]);
  assert.deepEqual(content("TXT", "_dmarc"), [
    ["v=DMARC1; p=reject", undefined],
  ]);
});

test("DNSSEC is enabled for the imported zone by OpenTofu", async () => {
  const dnssec = blocks(await configuration()).filter(
    (block) =>
      block.kind === "resource" && block.labels[0] === "cloudflare_zone_dnssec",
  );
  assert.equal(dnssec.length, 1);
  const [signing] = dnssec;
  assert.ok(signing);
  assert.equal(
    attribute(signing.body, "zone_id"),
    "cloudflare_zone.platform.id",
  );
  assert.equal(attribute(signing.body, "status"), '"active"');
});

test("the stack exposes the zone id for the run-time value and the DS record for the registrar, and nothing else", async () => {
  const outputs = blocks(await configuration()).filter(
    (block) => block.kind === "output",
  );
  assert.deepEqual(
    outputs
      .map((output) => output.labels[0] ?? "")
      .sort((a, b) => a.localeCompare(b)),
    ["ds_record", "zone_id"],
  );
});

test("the Cloudflare provider is pinned to one exact version that the compatibility matrix records", async () => {
  const versions = await stackFiles();
  const provider =
    /source\s*=\s*"cloudflare\/cloudflare"\s*\n\s*version\s*=\s*"([^"]+)"/.exec(
      versions["versions.tf"] ?? "",
    )?.[1];
  assert.equal(provider, "5.29.0");
  const matrix = await readFile(
    join(root, "infra/catalog/compatibility.md"),
    "utf8",
  );
  assert.match(matrix, /OpenTofu cloudflare\/cloudflare\s*\|\s*5\.29\.0\s*\|/);
});

test("no real domain, zone id, account id, token or public address is written in the stack or its runbook", async () => {
  const files = { ...(await stackFiles()), "README.md": await readme() };
  for (const [name, text] of Object.entries(files)) {
    assert.doesNotMatch(
      text,
      /\b[0-9a-f]{32}\b/,
      `${name} holds a 32-hex identifier, which is a zone or account id or a token`,
    );
    for (const address of text.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? []) {
      assert.ok(
        address.startsWith("192.0.2."),
        `${name} holds ${address}; use the documentation address 192.0.2.x`,
      );
    }
  }
  // Only quoted literals can hold a name; a reference such as
  // cloudflare_zone.platform.id is code, not a hostname.
  const hostnames = Object.entries(await stackFiles()).flatMap(([name, text]) =>
    [...text.matchAll(/"([^"]*)"/g)].flatMap((literal) =>
      (literal[1]?.match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/g) ?? []).map(
        (host) => `${name}: ${host}`,
      ),
    ),
  );
  assert.deepEqual(
    hostnames.filter(
      (host) => !/: (example\.com|letsencrypt\.org)$/.test(host),
    ),
    [],
    "only example.com and the Let's Encrypt name may appear in a stack file",
  );
});

test("the runbook names the token scopes, the import list, the registrar checklist and that state holds only public facts", async () => {
  const runbook = await readme();
  assert.match(runbook, /Zone Read/);
  assert.match(runbook, /DNS Edit/);
  assert.match(runbook, /12 months/);
  assert.match(runbook, /tofu import/);
  assert.match(runbook, /registrar lock/i);
  assert.match(runbook, /auto-renew/i);
  assert.match(runbook, /two-factor/i);
  assert.match(runbook, /public\s+facts/);
  assert.match(runbook, /example\.com/);
});
