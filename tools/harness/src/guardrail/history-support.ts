// Fakes for the inventory's git history: commits as `git log` and `git show` print them.
import type { FakeResponse } from "../runtime/runner-support.js";
import { INVENTORY_PATH } from "./inventory.js";

export interface FakeCommit {
  sha: string;
  /** Committer date, as `%cI` prints it. */
  date: string;
  text: string;
}

/** An inventory holding each named rule in its mode. */
export const inventoryOf = (modes: Record<string, string>): string =>
  JSON.stringify({
    guardrails: Object.entries(modes).map(([rule, mode]) => ({
      rule,
      kind: "bash",
      mode,
      owner: "guard.ts",
    })),
  });

/** Responses for the git calls on the inventory file; commits are newest first. */
export function gitHistory(commits: readonly FakeCommit[]): FakeResponse[] {
  return [
    {
      match: (c, a) => c === "git" && a[0] === "log",
      result: {
        stdout: commits.map((c) => `${c.sha} ${c.date}\n`).join(""),
      },
    },
    ...commits.map((c) => ({
      match: (cmd: string, a: readonly string[]) =>
        cmd === "git" &&
        a[0] === "show" &&
        a[1] === `${c.sha}:${INVENTORY_PATH}`,
      result: { stdout: c.text },
    })),
  ];
}
