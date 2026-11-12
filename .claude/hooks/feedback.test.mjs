import assert from "node:assert/strict";
import { test } from "node:test";

import { bound, isHarnessSource, isTrackedSource, postEdit, postEditHarness, stop, stopHarness } from "./feedback.mjs";

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

const lines = (count) => Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n");

test("bound leaves short output untouched", () => {
  assert.equal(bound(lines(40), "cmd"), lines(40));
});

test("bound keeps the first 40 lines and says how to see the rest", () => {
  const result = bound(lines(100), "npm run check");
  assert.match(result, /line 40\n/);
  assert.doesNotMatch(result, /line 41/);
  assert.match(result, /60 more lines cut/);
  assert.match(result, /npm run check/);
});

test("postEdit bounds a large lint report", () => {
  const deps = fakeDeps({ results: { "/repo/tools/kore/node_modules/.bin/oxlint": { status: 1, output: lines(500) } } });
  const result = postEdit(edited("/repo/tools/kore/src/a.ts"), deps);
  assert.equal(result.code, 2);
  assert.doesNotMatch(result.message, /line 41/);
  assert.match(result.message, /oxlint --deny-warnings \/repo\/tools\/kore\/src\/a\.ts/);
});

test("postEdit bounds a large format report", () => {
  const deps = fakeDeps({ results: { "/repo/tools/kore/node_modules/.bin/prettier": { status: 1, output: lines(500) } } });
  const result = postEdit(edited("/repo/tools/kore/src/a.ts"), deps);
  assert.equal(result.code, 2);
  assert.doesNotMatch(result.message, /line 41/);
  assert.match(result.message, /prettier --check \/repo\/tools\/kore\/src\/a\.ts/);
});

test("stop bounds a large typecheck report", () => {
  const deps = fakeDeps({ marked: true, results: { npm: { status: 2, output: lines(500) } } });
  const result = stop({}, deps);
  assert.equal(result.code, 2);
  assert.doesNotMatch(result.message, /line 41/);
  assert.match(result.message, /npm --prefix tools\/kore run check/);
});

function harnessDeps({ results = {}, marked = false } = {}) {
  const deps = fakeDeps({ results });
  let marker = marked;
  return Object.assign(deps, {
    markHarnessChanged: () => {
      marker = true;
    },
    hasHarnessChanged: () => marker,
    clearHarnessChanged: () => {
      marker = false;
    },
  });
}

test("isHarnessSource accepts only TypeScript under tools/harness/src or tests", () => {
  assert.equal(isHarnessSource("tools/harness/src/cli/cli.ts", root), true);
  assert.equal(isHarnessSource("/repo/tools/harness/tests/a.spec.ts", root), true);
  assert.equal(isHarnessSource("tools/harness/package.json", root), false);
  assert.equal(isHarnessSource("tools/kore/src/a.ts", root), false);
  assert.equal(isHarnessSource("skills/bin/harness.mjs", root), false);
});

test("postEdit leaves harness files to postEditHarness", () => {
  const deps = harnessDeps();
  assert.equal(postEdit(edited("/repo/tools/harness/src/a.ts"), deps).code, 0);
  assert.deepEqual(deps.calls, []);
});

test("postEditHarness ignores other files and runs nothing", () => {
  const deps = harnessDeps();
  assert.equal(postEditHarness(edited("/repo/tools/kore/src/a.ts"), deps).code, 0);
  assert.deepEqual(deps.calls, []);
  assert.equal(deps.hasHarnessChanged(), false);
});

test("postEditHarness lints and format-checks with the harness tools, and records the change", () => {
  const deps = harnessDeps();
  const result = postEditHarness(edited("/repo/tools/harness/src/a.ts"), deps);
  assert.equal(result.code, 0);
  assert.deepEqual(
    deps.calls.map(([command]) => command),
    ["/repo/tools/harness/node_modules/.bin/oxlint", "/repo/tools/harness/node_modules/.bin/prettier"],
  );
  assert.equal(deps.hasHarnessChanged(), true);
  assert.equal(deps.hasChanged(), false);
});

test("postEditHarness reports a lint violation in the same turn", () => {
  const deps = harnessDeps({ results: { "/repo/tools/harness/node_modules/.bin/oxlint": { status: 1, output: "no-shadow" } } });
  const result = postEditHarness(edited("/repo/tools/harness/src/a.ts"), deps);
  assert.equal(result.code, 2);
  assert.match(result.message, /no-shadow/);
});

test("postEditHarness reports a formatting violation with the pinned fix", () => {
  const deps = harnessDeps({ results: { "/repo/tools/harness/node_modules/.bin/prettier": { status: 1, output: "needs format" } } });
  const result = postEditHarness(edited("/repo/tools/harness/src/a.ts"), deps);
  assert.equal(result.code, 2);
  assert.match(result.message, /mise run format \/repo\/tools\/harness\/src\/a\.ts/);
});

test("stopHarness costs nothing when no harness TypeScript changed", () => {
  const deps = harnessDeps();
  assert.equal(stopHarness({}, deps).code, 0);
  assert.deepEqual(deps.calls, []);
});

test("stopHarness typechecks the harness and clears its marker on success", () => {
  const deps = harnessDeps({ marked: true });
  assert.equal(stopHarness({}, deps).code, 0);
  assert.deepEqual(deps.calls, [["npm", "--prefix", "tools/harness", "run", "check", "--silent"]]);
  assert.equal(deps.hasHarnessChanged(), false);
});

test("stopHarness blocks ending the turn on a harness type error and keeps the marker", () => {
  const deps = harnessDeps({ marked: true, results: { npm: { status: 2, output: "TS2322" } } });
  const result = stopHarness({}, deps);
  assert.equal(result.code, 2);
  assert.match(result.message, /TS2322/);
  assert.match(result.message, /harness/i);
  assert.equal(deps.hasHarnessChanged(), true);
});

test("stopHarness does not loop when already continuing from a stop hook", () => {
  const deps = harnessDeps({ marked: true, results: { npm: { status: 2, output: "TS2322" } } });
  assert.equal(stopHarness({ stop_hook_active: true }, deps).code, 0);
  assert.deepEqual(deps.calls, []);
});
