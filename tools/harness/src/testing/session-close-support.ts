import type { FakeResponse } from "./runner-support.js";

/** Where `git rev-parse --git-common-dir` says the main checkout's .git is. */
export const gitCommon: FakeResponse = {
  match: (c, a) => c === "git" && a.includes("--git-common-dir"),
  result: { stdout: "/main/.git\n" },
};

/** The state file the registry keeps for one spawned session. */
export const stateFile = (name: string): string =>
  `/main/.kore/state/sessions/${name}.json`;
