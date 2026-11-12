import type { testHarness } from "../cli/cli-support.js";
import type { FakeResponse } from "../runtime/runner-support.js";

export const INSIDE = { HERDR_ENV: "1", HERDR_PANE_ID: "w3:p1" };

export const pane = (id: string, x: number, y: number) => ({
  pane_id: id,
  rect: { x, y, width: 100, height: 10 },
});

export const layoutOf = (
  ...panes: ReturnType<typeof pane>[]
): FakeResponse => ({
  match: (_c, a) => a[1] === "layout",
  result: {
    stdout: JSON.stringify({
      result: {
        layout: { panes: [pane("w3:p1", 0, 0), ...panes], splits: [] },
      },
    }),
  },
});

export const splitReturns = (id: string): FakeResponse => ({
  match: (_c, a) => a[1] === "split",
  result: { stdout: JSON.stringify({ result: { pane: { pane_id: id } } }) },
});

export const nameFree: FakeResponse = {
  match: (_c, a) => a[1] === "get",
  result: {
    code: 1,
    stderr: '{"error":{"code":"agent_not_found","message":"not found"}}',
  },
};

export const spawnArgs = [
  "session",
  "spawn",
  "--role",
  "writer",
  "--model",
  "claude-sonnet-5-5",
  "--effort",
  "high",
  "--name",
  "image-trust-writer",
  "--brief",
  "Do the thing.",
  "--no-wait",
];

export function herdrCalls(h: ReturnType<typeof testHarness>): string[] {
  return h.runner.calls.map((c) => `${c.command} ${c.args.join(" ")}`);
}
