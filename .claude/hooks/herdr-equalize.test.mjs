// herdr-equalize: spawned sessions stack in one column; each split halves the
// pane above it, so the column must be rebalanced to equal heights.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(
  new URL("../../skills/spawn-session/equalize.zsh", import.meta.url),
);

const pane = (id, x, y, height) => ({
  pane_id: id,
  rect: { x, y, width: 100, height },
});
const split = (direction, y, ratio) => ({
  direction,
  ratio,
  rect: { x: 100, y, width: 100, height: 100 },
});

function run(t, layout) {
  const dir = mkdtempSync(join(tmpdir(), "kore-herdr-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const calls = join(dir, "calls");
  writeFileSync(calls, "");
  writeFileSync(join(dir, "layout.json"), JSON.stringify({ result: { layout } }));
  const fake = join(dir, "herdr");
  writeFileSync(
    fake,
    `#!/bin/sh\nif [ "$2" = layout ]; then cat "${dir}/layout.json"; else echo "$*" >> "${calls}"; fi\n`,
  );
  chmodSync(fake, 0o755);
  execFileSync("zsh", [script], {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
  });
  return readFileSync(calls, "utf8").trim().split("\n").filter(Boolean);
}

test("each column split moves to 1/(panes left), growing down and shrinking from below", (t) => {
  const calls = run(t, {
    panes: [
      pane("main", 0, 0, 100),
      pane("a", 100, 0, 50),
      pane("b", 100, 50, 25),
      pane("c", 100, 75, 25),
    ],
    splits: [split("right", 0, 0.5), split("down", 0, 0.5), split("down", 50, 0.5)],
  });
  // Split 1 is 0.5 and wants 1/3: shrink it by resizing the pane below it up.
  // Split 2 is 0.5 and wants 1/2: already equal, so no call.
  assert.deepEqual(calls, ["pane resize --pane b --direction up --amount 0.166667"]);
});

test("a split below its target grows by resizing the pane above it down", (t) => {
  const calls = run(t, {
    panes: [pane("main", 0, 0, 100), pane("a", 100, 0, 20), pane("b", 100, 20, 80)],
    splits: [split("right", 0, 0.5), split("down", 0, 0.2)],
  });
  assert.deepEqual(calls, ["pane resize --pane a --direction down --amount 0.300000"]);
});

test("a single spawned pane needs no resize", (t) => {
  const calls = run(t, {
    panes: [pane("main", 0, 0, 100), pane("a", 100, 0, 100)],
    splits: [split("right", 0, 0.5)],
  });
  assert.deepEqual(calls, []);
});
