import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, test } from "vitest";
import { findRoot } from "../config/config.js";

// Offline proof that every OpenTofu stack pins OpenTofu and each provider to an
// exact version (AGENTS.md: pin everything), and declares no backend or
// credentials, so `tofu validate` needs neither an account nor a network apply.

const root = await findRoot();
const stacksDirectory = join(root, "infra/tofu/stacks");
const stacks = (await readdir(stacksDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

async function configuration(stack: string): Promise<string> {
  const directory = join(stacksDirectory, stack);
  const files = (await readdir(directory)).filter((name) =>
    name.endsWith(".tf"),
  );
  const texts = await Promise.all(
    files.map((name) => readFile(join(directory, name), "utf8")),
  );
  return texts.join("\n");
}

const exact = /^\d+\.\d+\.\d+$/;

test("the managed-example stack is a real stack, not a placeholder", () => {
  assert.ok(stacks.includes("managed-example"));
});

describe.each(stacks)("stack %s", (stack) => {
  test("pins OpenTofu to the version mise installs", async () => {
    const text = await configuration(stack);
    const required = /required_version\s*=\s*"([^"]+)"/.exec(text)?.[1];
    const mise = await readFile(join(root, ".mise.toml"), "utf8");
    const pinned = /^opentofu\s*=\s*"([^"]+)"/m.exec(mise)?.[1];
    assert.ok(required, "required_version is missing");
    assert.equal(required, pinned);
  });

  test("pins every provider to an exact version", async () => {
    const text = await configuration(stack);
    const versions = [...text.matchAll(/\bversion\s*=\s*"([^"]*)"/g)].map(
      (match) => match[1] ?? "",
    );
    assert.ok(versions.length > 0, "no provider is declared");
    for (const version of versions) {
      assert.match(version, exact, `provider version "${version}" is a range`);
    }
  });

  test("declares no backend, so validation never reaches remote state", async () => {
    assert.doesNotMatch(await configuration(stack), /\bbackend\s+"/);
  });

  test("carries no credential material", async () => {
    assert.doesNotMatch(
      await configuration(stack),
      /(access_key|secret_key|token|password)\s*=/i,
    );
  });
});
