import { describe, expect, it } from "vitest";
import { testHarness } from "../cli/cli-support.js";
import { equalize } from "./equalize.js";

const pane = (id: string, x: number, y: number, height: number) => ({
  pane_id: id,
  rect: { x, y, width: 100, height },
});
const split = (direction: string, y: number, ratio: number, x = 100) => ({
  direction,
  ratio,
  rect: { x, y, width: 100, height: 100 },
});

async function resizes(layout: {
  panes: unknown[];
  splits: unknown[];
}): Promise<string[]> {
  const h = testHarness({
    responses: [
      {
        match: (_c, a) => a[1] === "layout",
        result: { stdout: JSON.stringify({ result: { layout } }) },
      },
    ],
  });
  await equalize(h.deps.runner, "main");
  return h.runner.calls
    .filter((c) => c.args[1] === "resize")
    .map((c) => c.args.join(" "));
}

describe("equalize", () => {
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
    const h = testHarness({
      responses: [
        {
          match: (_c, a) => a[1] === "layout",
          result: {
            stdout: JSON.stringify({
              result: {
                layout: { panes: [pane("main", 0, 0, 100)], splits: [] },
              },
            }),
          },
        },
      ],
    });
    await equalize(h.deps.runner, "main");
    expect(h.runner.calls[0]?.args).toEqual([
      "pane",
      "layout",
      "--pane",
      "main",
    ]);
  });
});

const layoutResponse = (layout: unknown, resize = {}) => [
  {
    match: (_c: string, a: readonly string[]) => a[1] === "layout",
    result: { stdout: JSON.stringify({ result: { layout } }) },
  },
  {
    match: (_c: string, a: readonly string[]) => a[1] === "resize",
    result: resize,
  },
];

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
    const h = testHarness({ responses: layoutResponse(column) });
    expect(await equalize(h.deps.runner, "main")).toEqual({
      status: "equalized",
    });
  });

  it("only counts a column right of the caller as spawned", async () => {
    const h = testHarness({ responses: layoutResponse(column) });
    const result = await equalize(h.deps.runner, "b");
    expect(result.status).toBe("skipped");
    expect(h.runner.calls.some((c) => c.args[1] === "resize")).toBe(false);
  });

  it("skips with a reason when the splits do not match the panes", async () => {
    const h = testHarness({
      responses: layoutResponse({
        ...column,
        splits: [split("right", 0, 0.5, 0)],
      }),
    });
    expect(await equalize(h.deps.runner, "main")).toEqual({
      status: "skipped",
      reason: expect.stringContaining("layout") as unknown,
    });
  });

  it("fails naming herdr's error when the layout cannot be read", async () => {
    const h = testHarness({
      responses: [
        {
          match: (_c, a) => a[1] === "layout",
          result: { code: 1, stderr: "pane gone" },
        },
      ],
    });
    expect(await equalize(h.deps.runner, "main")).toEqual({
      status: "failed",
      reason: expect.stringContaining("pane gone") as unknown,
    });
  });

  it("fails naming herdr's error when a resize fails", async () => {
    const h = testHarness({
      responses: layoutResponse(column, { code: 1, stderr: "too small" }),
    });
    expect(await equalize(h.deps.runner, "main")).toEqual({
      status: "failed",
      reason: expect.stringContaining("too small") as unknown,
    });
  });
});
