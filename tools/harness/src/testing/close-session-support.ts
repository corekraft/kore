import type { TestHarness } from "./cli-support.js";
import type { FakeResponse } from "./runner-support.js";

// Fixtures for the session close integration spec: the same answers the unit
// session specs give, kept in the testing domain so the spec imports only the
// testing barrel.

export const INSIDE = { HERDR_ENV: "1", HERDR_PANE_ID: "w3:p1" };

const pane = (id: string, x: number, y: number) => ({
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

/** Where `git rev-parse --git-common-dir` says the main checkout's .git is. */
export const gitCommon: FakeResponse = {
  match: (c, a) => c === "git" && a.includes("--git-common-dir"),
  result: { stdout: "/main/.git\n" },
};

/** The state file the registry keeps for one spawned session. */
export const stateFile = (name: string): string =>
  `/main/.kore/state/sessions/${name}.json`;

export function herdrCalls(h: TestHarness): string[] {
  return h.runner.calls
    .filter((c) => c.command === "herdr")
    .map((c) => `${c.command} ${c.args.join(" ")}`);
}
