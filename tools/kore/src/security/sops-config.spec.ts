import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { loadRepository } from "../config/index.js";

const recipient = /^\s+age: (age1[02-9ac-hj-np-z]{58})$/m;

async function read(path: string): Promise<string> {
  const { root } = await loadRepository("local");
  return readFile(join(root, path), "utf8");
}

test("the local SOPS rule encrypts to a real age recipient, not the placeholder", async () => {
  const config = await read(".sops.yaml");
  assert.doesNotMatch(config, /AGE-RECIPIENT-MUST-BE-CONFIGURED/);
  assert.match(config, recipient);
});

test("the committed local canary secret is SOPS-encrypted to that recipient", async () => {
  const [, age] = (await read(".sops.yaml")).match(recipient)!;
  const canary = await read(
    "infra/environments/local/secrets/sops-canary.enc.yaml",
  );
  assert.match(canary, /^sops:$/m);
  assert.ok(canary.includes(`recipient: ${age}`));
  assert.match(canary, /^\s+canary: ENC\[AES256_GCM,/m);
  assert.doesNotMatch(canary, /BEGIN AGE ENCRYPTED FILE[\s\S]*AGE-SECRET-KEY/);
});
