import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { loadRepository } from "../../src/config/index.js";
import { comparePinnedTools, parseMiseTools } from "./tool-pins-support.js";

test("a tool pinned at different versions in .mise.toml and the tool catalog is named with both versions", () => {
  assert.deepEqual(comparePinnedTools({ k3d: "5.9.0" }, { k3d: "5.9.1" }), [
    "k3d: .mise.toml pins 5.9.0, infra/catalog/versions.yaml pins 5.9.1",
  ]);
});

test("a tool pinned at the same version in both files passes", () => {
  assert.deepEqual(comparePinnedTools({ k3d: "5.9.0" }, { k3d: "5.9.0" }), []);
});

test("opentofu in .mise.toml is compared with tofu in the tool catalog, and a version change in either file fails", () => {
  assert.deepEqual(
    comparePinnedTools({ opentofu: "1.13.9" }, { tofu: "1.13.9" }),
    [],
  );
  assert.deepEqual(
    comparePinnedTools({ opentofu: "1.13.8" }, { tofu: "1.13.9" }),
    ["tofu: .mise.toml pins 1.13.8, infra/catalog/versions.yaml pins 1.13.9"],
  );
});

test("a tool pinned only in .mise.toml fails and is named", () => {
  assert.deepEqual(comparePinnedTools({ gh: "2.99.0" }, {}), [
    "gh is pinned in .mise.toml but not in infra/catalog/versions.yaml; add it to the catalog or allow it",
  ]);
});

test("a tool pinned only in the tool catalog fails and is named, unless it is on the allow list", () => {
  assert.deepEqual(comparePinnedTools({}, { gh: "2.99.0" }), [
    "gh is pinned in infra/catalog/versions.yaml but not in .mise.toml; add it to .mise.toml or allow it",
  ]);
});

test("docker, which is a host prerequisite mise does not install, may live only in the tool catalog", () => {
  assert.deepEqual(comparePinnedTools({}, { docker: "29.7.2" }), []);
});

test("an allow-list entry that is pinned in both files is reported as stale", () => {
  assert.deepEqual(
    comparePinnedTools({ docker: "29.7.2" }, { docker: "29.7.2" }),
    [
      "docker is in both files but listed as catalog-only; remove it from the allow list",
    ],
  );
});

test("a tool name that merely looks like an object property is not treated as allowed", () => {
  assert.deepEqual(comparePinnedTools({}, { constructor: "1.0.0" }), [
    "constructor is pinned in infra/catalog/versions.yaml but not in .mise.toml; add it to .mise.toml or allow it",
  ]);
});

test("parseMiseTools reads only the [tools] table and ignores comments and other tables", () => {
  const text = [
    "# pins",
    "[tools]",
    'node = "26.13.0"',
    'opentofu = "1.13.9" ',
    "",
    "[tasks.build]",
    'description = "Build"',
    'run = "npm run build"',
  ].join("\n");
  assert.deepEqual(parseMiseTools(text), {
    node: "26.13.0",
    opentofu: "1.13.9",
  });
});

test("parseMiseTools fails with the offending line when a tool pin is not written as name = version", () => {
  assert.throws(
    () => parseMiseTools('[tools]\nk3d = ["5.9.0"]\n'),
    /\.mise\.toml line 'k3d = \["5\.9\.0"\]' is not a tool pin; write it as name = "version"/,
  );
});

test("every tool .mise.toml and the tool catalog both pin is at the same version, and no tool is in only one file without an allow-list entry", async () => {
  const { root, versions } = await loadRepository("local");
  const mise = parseMiseTools(await readFile(join(root, ".mise.toml"), "utf8"));
  assert.equal(mise.node, versions.tools.node, "the parse reads .mise.toml");
  assert.deepEqual(comparePinnedTools(mise, versions.tools), []);
});
