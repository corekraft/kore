import { describe, expect, it, vi } from "vitest";
import type { RunResult, Runner } from "../runtime/index.js";
import { equalize } from "./equalize.js";

const ok: RunResult = { stdout: "", stderr: "", code: 0 };

/**
 * A typed runner that answers `pane layout` with `layout`, `pane resize` with
 * `resize` (success by default), and anything else with success. Each call is
 * recorded for the assertions.
 */
function layoutRunner(
  layout: unknown,
  {
    layoutResult,
    resize = ok,
  }: { layoutResult?: RunResult; resize?: RunResult } = {},
) {
  const run = vi.fn<Runner["run"]>((_command, args) => {
    if (args[1] === "layout") {
      return Promise.resolve(
        layoutResult ?? {
          ...ok,
          stdout: JSON.stringify({ result: { layout } }),
        },
      );
    }
    return Promise.resolve(args[1] === "resize" ? resize : ok);
  });
  return { runner: { run } satisfies Runner, run };
}

const pane = (id: string, x: number, y: number, height: number) => ({
  pane_id: id,
  rect: { x, y, width: 100, height },
});
const split = (direction: string, y: number, ratio: number, x = 100) => ({
  direction,
  ratio,
  rect: { x, y, width: 100, height: 100 },
});

/** The arguments of each `pane resize` call, as one line each. */
async function resizes(layout: { panes: unknown[]; splits: unknown[] }) {
  const { runner, run } = layoutRunner(layout);
  await equalize(runner, "main");
  return run.mock.calls
    .map(([, args]) => args)
    .filter((args) => args[1] === "resize")
    .map((args) => args.join(" "));
}

describe("equalize moves each split toward its column's share", () => {
  it("moves each column split to 1/(panes left), growing down and shrinking from below", async () => {
    // Split 1 is 0.5 and wants 1/3: shrink it by resizing the pane below it up.
    // Split 2 is 0.5 and wants 1/2: already equal, so no call.
    expect(
      await resizes({
        panes: [
          pane("main", 0, 0, 100),
          pane("a", 100, 0, 50),
          pane("b", 100, 50, 25),
          pane("c", 100, 75, 25),
        ],
        splits: [
          split("right", 0, 0.5, 0),
          split("down", 0, 0.5),
          split("down", 50, 0.5),
        ],
      }),
    ).toEqual(["pane resize --pane b --direction up --amount 0.166667"]);
  });

  it("grows a split below its target by resizing the pane above it down", async () => {
    expect(
      await resizes({
        panes: [
          pane("main", 0, 0, 100),
          pane("a", 100, 0, 20),
          pane("b", 100, 20, 80),
        ],
        splits: [split("right", 0, 0.5, 0), split("down", 0, 0.2)],
      }),
    ).toEqual(["pane resize --pane a --direction down --amount 0.300000"]);
  });
});

describe("equalize edge cases", () => {
  it("needs no resize for a single spawned pane", async () => {
    expect(
      await resizes({
        panes: [pane("main", 0, 0, 100), pane("a", 100, 0, 100)],
        splits: [split("right", 0, 0.5, 0)],
      }),
    ).toEqual([]);
  });

  it("equalizes only the rightmost column when panes sit in two columns", async () => {
    expect(
      await resizes({
        panes: [
          pane("main", 0, 0, 100),
          pane("mid", 50, 0, 100),
          pane("a", 150, 0, 70),
          pane("b", 150, 70, 30),
        ],
        splits: [
          split("right", 0, 0.33, 0),
          split("right", 0, 0.5, 50),
          split("down", 0, 0.7, 150),
        ],
      }),
    ).toEqual(["pane resize --pane b --direction up --amount 0.200000"]);
  });

  it("leaves a layout whose splits do not match its panes alone", async () => {
    expect(
      await resizes({
        panes: [
          pane("main", 0, 0, 100),
          pane("a", 100, 0, 50),
          pane("b", 100, 50, 50),
        ],
        splits: [split("right", 0, 0.5, 0)],
      }),
    ).toEqual([]);
  });

  it("reads the layout for the caller's pane", async () => {
    const { runner, run } = layoutRunner({
      panes: [pane("main", 0, 0, 100)],
      splits: [],
    });
    await equalize(runner, "main");
    expect(run.mock.calls).toEqual([
      ["herdr", ["pane", "layout", "--pane", "main"]],
    ]);
  });
});

describe("equalize outcome", () => {
  const column = {
    panes: [
      pane("main", 0, 0, 100),
      pane("a", 100, 0, 50),
      pane("b", 100, 50, 25),
      pane("c", 100, 75, 25),
    ],
    splits: [
      split("right", 0, 0.5, 0),
      split("down", 0, 0.5),
      split("down", 50, 0.5),
    ],
  };

  it("reports equalized after resizing", async () => {
    const { runner } = layoutRunner(column);
    expect(await equalize(runner, "main")).toEqual({ status: "equalized" });
  });

  it("only counts a column right of the caller as spawned", async () => {
    const { runner, run } = layoutRunner(column);
    expect(await equalize(runner, "b")).toEqual({
      status: "skipped",
      reason: "no spawned column right of the caller",
    });
    expect(run.mock.calls.some(([, args]) => args[1] === "resize")).toBe(false);
  });

  it("skips with a reason when the splits do not match the panes", async () => {
    const { runner } = layoutRunner({
      ...column,
      splits: [split("right", 0, 0.5, 0)],
    });
    expect(await equalize(runner, "main")).toEqual({
      status: "skipped",
      reason: "layout splits do not match the spawned panes",
    });
  });

  it("fails naming herdr's error when the layout cannot be read", async () => {
    const { runner } = layoutRunner(undefined, {
      layoutResult: { ...ok, code: 1, stderr: "pane gone" },
    });
    expect(await equalize(runner, "main")).toEqual({
      status: "failed",
      reason: "herdr pane layout failed: pane gone",
    });
  });

  it("fails naming herdr's error when a resize fails", async () => {
    const { runner } = layoutRunner(column, {
      resize: { ...ok, code: 1, stderr: "too small" },
    });
    expect(await equalize(runner, "main")).toEqual({
      status: "failed",
      reason: "herdr pane resize failed: too small",
    });
  });
});
