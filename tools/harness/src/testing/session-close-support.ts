import type { FakeResponse } from "./runner-support.js";
import type { testHarness } from "./cli-support.js";

/** The environment of a pane inside Herdr, as the caller pane w3:p1. */
export const INSIDE = { HERDR_ENV: "1", HERDR_PANE_ID: "w3:p1" };

const pane = (id: string, x: number, y: number) => ({
  pane_id: id,
  rect: { x, y, width: 100, height: 10 },
});

/** What `herdr pane layout` shows for the caller's column. */
export const layoutOf = (): FakeResponse => ({
  match: (_c, a) => a[1] === "layout",
  result: {
    stdout: JSON.stringify({
      result: {
        layout: { panes: [pane("w3:p1", 0, 0)], splits: [] },
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

/** The herdr commands a test ran, as `herdr <args>` lines. */
export function herdrCalls(h: ReturnType<typeof testHarness>): string[] {
  return h.runner.calls
    .filter((c) => c.command === "herdr")
    .map((c) => `${c.command} ${c.args.join(" ")}`);
}
