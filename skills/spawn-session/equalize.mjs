#!/usr/bin/env node
// Equalize the column of spawned panes to the right of the main pane.
// Each new pane splits the one above it, so heights halve down the column.
// Split i (top to bottom) between pane i and i+1 must hold 1/(panes left).
// `resize --direction down` on a pane moves its bottom edge (grows the split
// above it); `--direction up` moves its top edge, so a split shrinks by
// resizing the pane below it up.
import { execFileSync } from "node:child_process";

const herdr = (...args) => execFileSync("herdr", args, { encoding: "utf8" });
const { layout } = JSON.parse(herdr("pane", "layout")).result;
const byY = (a, b) => a.rect.y - b.rect.y;
// Spawned sessions stack in the rightmost column; equalize only that column.
const column = Math.max(...layout.panes.map((p) => p.rect.x));
const panes = layout.panes.filter((p) => p.rect.x === column).sort(byY);
const splits = layout.splits
  .filter((s) => s.direction === "down" && s.rect.x === column)
  .sort(byY);
if (column === 0 || splits.length !== panes.length - 1) {
  // No spawned column, or a layout this script doesn't understand: leave it.
  process.exit(0);
}

for (let i = 0; i < panes.length - 1; i++) {
  const delta = 1 / (panes.length - i) - splits[i].ratio;
  if (Math.abs(delta) <= 0.0005) continue;
  const [pane, direction] =
    delta < 0 ? [panes[i + 1], "up"] : [panes[i], "down"];
  herdr(
    "pane",
    "resize",
    "--pane",
    pane.pane_id,
    "--direction",
    direction,
    "--amount",
    Math.abs(delta).toFixed(6),
  );
}
