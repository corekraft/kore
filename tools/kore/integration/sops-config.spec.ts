import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { loadRepository } from "../src/config/index.js";

const RECIPIENT = /^age1[02-9ac-hj-np-z]{58}$/;

async function read(path: string): Promise<string> {
  const { root } = await loadRepository("local");
  return readFile(join(root, path), "utf8");
}

/** The public recipients the local creation rule names: a comma-separated `age:` list. */
function localRecipients(config: string): string[] {
  const rule = config
    .split(/^\s*-\s+path_regex:/m)
    .find((chunk) => chunk.includes("environments/local/secrets/"));
  const age = rule?.match(/^\s+age: (.+)$/m)?.[1];
  assert.ok(age, "the local creation rule names an age recipient");
  return age.split(",").map((entry) => entry.trim());
}

test("the local SOPS rule encrypts to real age recipients, not the placeholder", async () => {
  const config = await read(".sops.yaml");
  assert.doesNotMatch(config, /AGE-RECIPIENT-MUST-BE-CONFIGURED/);
  const recipients = localRecipients(config);
  assert.ok(recipients.length >= 1);
  for (const recipient of recipients) {
    assert.match(recipient, RECIPIENT);
  }
});

test("the committed local canary secret is SOPS-encrypted to every local recipient", async () => {
  const recipients = localRecipients(await read(".sops.yaml"));
  const canary = await read(
    "infra/environments/local/secrets/sops-canary.enc.yaml",
  );
  assert.match(canary, /^sops:$/m);
  for (const recipient of recipients) {
    assert.ok(canary.includes(`recipient: ${recipient}`));
  }
  assert.match(canary, /^\s+canary: ENC\[AES256_GCM,/m);
  assert.doesNotMatch(canary, /BEGIN AGE ENCRYPTED FILE[\s\S]*AGE-SECRET-KEY/);
});
