import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { format, resolveConfig } from "prettier";
import { test } from "vitest";

const root = resolve(import.meta.dirname, "../../../..");

for (const file of [
  "infra/catalog/components.yaml",
  "infra/catalog/versions.yaml",
]) {
  test(`formatting ${file} keeps it JSON-compatible YAML`, async () => {
    const path = resolve(root, file);
    const options = await resolveConfig(path);

    const formatted = await format(await readFile(path, "utf8"), {
      ...options,
      filepath: path,
    });

    assert.doesNotThrow(
      () => JSON.parse(formatted),
      "prettier added syntax that breaks the JSON-compatible YAML rule (trailing commas?)",
    );
  });
}

test("the formatter never rewrites SOPS-encrypted documents", async () => {
  const { getFileInfo } = await import("prettier");
  const path = resolve(
    root,
    "infra/environments/local/secrets/sops-canary.enc.yaml",
  );
  const info = await getFileInfo(path, {
    ignorePath: resolve(root, ".prettierignore"),
  });
  assert.equal(info.ignored, true);
});
