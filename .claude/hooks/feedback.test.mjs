import assert from "node:assert/strict";
import { test } from "node:test";

import { isTrackedSource, postEdit, stop } from "./feedback.mjs";

const root = "/repo";

function fakeDeps({ results = {}, marked = false } = {}) {
  const calls = [];
  let marker = marked;
  return {
    calls,
    root,
    run: (command, args) => {
      calls.push([command, ...args]);
      return results[command] ?? { status: 0, output: "" };
    },
    markChanged: () => {
      marker = true;
    },
    hasChanged: () => marker,
    clearChanged: () => {
      marker = false;
    },
  };
}

const edited = (file_path) => ({ tool_name: "Edit", tool_input: { file_path } });

test("isTrackedSource accepts only TypeScript under tools/kore/src", () => {
  assert.equal(isTrackedSource("tools/kore/src/cli/cli.ts", root), true);
  assert.equal(isTrackedSource("/repo/tools/kore/src/a/b.ts", root), true);
  assert.equal(isTrackedSource("tools/kore/src/a.spec.ts", root), true);
  assert.equal(isTrackedSource("tools/kore/package.json", root), false);
  assert.equal(isTrackedSource("README.md", root), false);
});

test("postEdit ignores files outside the tracked sources and runs nothing", () => {
  const deps = fakeDeps();
  const result = postEdit(edited("/repo/README.md"), deps);
  assert.equal(result.code, 0);
  assert.deepEqual(deps.calls, []);
  assert.equal(deps.hasChanged(), false);
});

test("postEdit stays quiet when formatting and lint pass, and records the change", () => {
  const deps = fakeDeps();
  const result = postEdit(edited("/repo/tools/kore/src/a.ts"), deps);
  assert.equal(result.code, 0);
  assert.equal(deps.calls.length, 2);
  assert.equal(deps.hasChanged(), true);
});

test("postEdit reports a lint violation in the same turn", () => {
  const deps = fakeDeps({ results: { "/repo/tools/kore/node_modules/.bin/oxlint": { status: 1, output: "no-unused-vars" } } });
  const result = postEdit(edited("/repo/tools/kore/src/a.ts"), deps);
  assert.equal(result.code, 2);
  assert.match(result.message, /no-unused-vars/);
  assert.match(result.message, /oxlint/);
});

test("postEdit reports a formatting violation with the fix", () => {
  const deps = fakeDeps({ results: { "/repo/tools/kore/node_modules/.bin/prettier": { status: 1, output: "needs format" } } });
  const result = postEdit(edited("/repo/tools/kore/src/a.ts"), deps);
  assert.equal(result.code, 2);
  assert.match(result.message, /prettier --write/);
});

test("stop costs nothing when no TypeScript changed", () => {
  const deps = fakeDeps();
  const result = stop({}, deps);
  assert.equal(result.code, 0);
  assert.deepEqual(deps.calls, []);
});

test("stop typechecks after TypeScript changed and clears the marker on success", () => {
  const deps = fakeDeps({ marked: true });
  const result = stop({}, deps);
  assert.equal(result.code, 0);
  assert.deepEqual(deps.calls, [["npm", "--prefix", "tools/kore", "run", "check", "--silent"]]);
  assert.equal(deps.hasChanged(), false);
});

test("stop blocks ending the turn on a type error and keeps the marker", () => {
  const deps = fakeDeps({ marked: true, results: { npm: { status: 2, output: "TS2322" } } });
  const result = stop({}, deps);
  assert.equal(result.code, 2);
  assert.match(result.message, /TS2322/);
  assert.equal(deps.hasChanged(), true);
});

test("stop does not loop when the harness is already continuing from a stop hook", () => {
  const deps = fakeDeps({ marked: true, results: { npm: { status: 2, output: "TS2322" } } });
  const result = stop({ stop_hook_active: true }, deps);
  assert.equal(result.code, 0);
  assert.deepEqual(deps.calls, []);
});
