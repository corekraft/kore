import type { RunResult, Runner } from "../runtime/index.js";

interface Rect {
  x: number;
  y: number;
}
interface LayoutPane {
  pane_id: string;
  rect: Rect;
}
interface LayoutSplit {
  direction: string;
  ratio: number;
  rect: Rect;
}
export interface Layout {
  panes: LayoutPane[];
  splits: LayoutSplit[];
}

export type LayoutRead = { layout: Layout } | { error: string };

export type EqualizeResult =
  | { status: "equalized" }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string };

const byY = (a: { rect: Rect }, b: { rect: Rect }) => a.rect.y - b.rect.y;

/** What herdr said, for an error message. */
export function describeFailure(result: RunResult): string {
  return (result.stderr || result.stdout).trim() || `exit code ${result.code}`;
}

/** Reads the Herdr layout around the caller's pane; the error names herdr's own words. */
export async function readLayout(
  runner: Runner,
  callerPane: string,
): Promise<LayoutRead> {
  const result = await runner.run("herdr", [
    "pane",
    "layout",
    "--pane",
    callerPane,
  ]);
  if (result.code !== 0) {
    return {
      error: `herdr pane layout failed: ${describeFailure(result)}`,
    };
  }
  try {
    const parsed = JSON.parse(result.stdout) as {
      result?: { layout?: Layout };
    };
    const layout = parsed.result?.layout;
    if (layout !== undefined) {
      return { layout };
    }
  } catch {
    // fall through to the shared error
  }
  return {
    error: `herdr pane layout returned no layout (.result.layout): ${result.stdout.trim()}`,
  };
}

/**
 * The panes of the column right of the caller, top to bottom: the rightmost
 * column, counted only when it lies right of the caller's pane. Empty when the
 * caller is in the rightmost column or is not in the layout.
 */
export function spawnedColumn(
  layout: Layout,
  callerPane: string,
): LayoutPane[] {
  const caller = layout.panes.find((p) => p.pane_id === callerPane);
  const column = Math.max(...layout.panes.map((p) => p.rect.x));
  if (caller === undefined || column <= caller.rect.x) {
    return [];
  }
  return layout.panes.filter((p) => p.rect.x === column).sort(byY);
}

/**
 * Equalizes the column of spawned panes right of the caller. Each new pane
 * splits the one above it, so heights halve down the column; split i must hold
 * 1/(panes left). `resize --direction down` moves a pane's bottom edge (grows
 * the split above it); `--direction up` moves its top edge, so a split shrinks
 * by resizing the pane below it up. A layout it does not understand is skipped
 * with a reason; a herdr failure is reported as failed, never swallowed.
 */
export async function equalize(
  runner: Runner,
  callerPane: string,
): Promise<EqualizeResult> {
  const read = await readLayout(runner, callerPane);
  if ("error" in read) {
    return { status: "failed", reason: read.error };
  }
  const { layout } = read;
  const panes = spawnedColumn(layout, callerPane);
  const column = panes[0]?.rect.x;
  if (column === undefined) {
    return {
      status: "skipped",
      reason: "no spawned column right of the caller",
    };
  }
  const splits = layout.splits
    .filter((s) => s.direction === "down" && s.rect.x === column)
    .sort(byY);
  if (splits.length !== panes.length - 1) {
    return {
      status: "skipped",
      reason: "layout splits do not match the spawned panes",
    };
  }
  for (const [i, split] of splits.entries()) {
    const delta = 1 / (panes.length - i) - split.ratio;
    if (Math.abs(delta) <= 0.0005) {
      continue;
    }
    const [pane, direction] =
      delta < 0 ? [panes[i + 1], "up"] : [panes[i], "down"];
    const resize = await runner.run("herdr", [
      "pane",
      "resize",
      "--pane",
      (pane as LayoutPane).pane_id,
      "--direction",
      direction as string,
      "--amount",
      Math.abs(delta).toFixed(6),
    ]);
    if (resize.code !== 0) {
      return {
        status: "failed",
        reason: `herdr pane resize failed: ${describeFailure(resize)}`,
      };
    }
  }
  return { status: "equalized" };
}
