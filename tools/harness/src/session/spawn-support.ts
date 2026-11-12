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

/** Where `git rev-parse --git-common-dir` says the main checkout's .git is. */
export const gitCommon: FakeResponse = {
  match: (c, a) => c === "git" && a.includes("--git-common-dir"),
  result: { stdout: "/main/.git\n" },
};

/** The state file the registry keeps for one spawned session. */
export const stateFile = (name: string): string =>
  `/main/.kore/state/sessions/${name}.json`;

/** What `herdr agent read` or `herdr pane read` shows: the given terminal text. */
export const screen = (text: string): FakeResponse => ({
  match: (_c, a) => a[1] === "read",
  result: { stdout: text },
});

/** A response that changes with each matching call; the last entry repeats. */
export const sequence = (
  match: FakeResponse["match"],
  ...results: FakeResponse["result"][]
): FakeResponse => {
  let calls = 0;
  return {
    match: (c, a) => match(c, a),
    get result() {
      const next = results[Math.min(calls, results.length - 1)] ?? {};
      calls += 1;
      return next;
    },
  };
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
  return h.runner.calls
    .filter((c) => c.command === "herdr")
    .map((c) => `${c.command} ${c.args.join(" ")}`);
}
