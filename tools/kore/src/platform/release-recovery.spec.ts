import { expect, test } from "vitest";
import { loadRepository } from "../config/index.js";
import { CommandError, type Runner } from "../runtime/index.js";
import { recoverRelease } from "./release-recovery.js";

type Revision = { revision: number; status: string };

/** A Helm release whose history changes as uninstall and rollback run. */
function helm(history: Revision[] | undefined, stuckAfterUninstall = false) {
  const calls: string[][] = [];
  let state = history;
  const runner: Runner = {
    async run(command, args) {
      calls.push([command, ...args]);
      if (args[0] === "history") {
        if (!state) {
          throw new CommandError(command, args, {
            stdout: "",
            stderr: "Error: release: not found",
            code: 1,
          });
        }
        return { stdout: JSON.stringify(state), stderr: "", code: 0 };
      }
      if (args[0] === "uninstall" && !stuckAfterUninstall) {
        state = undefined;
      }
      if (args[0] === "rollback" && state) {
        state = [...state, { revision: state.length + 1, status: "deployed" }];
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  };
  return { runner, calls };
}
const target = { name: "reference", namespace: "reference", timeout: "10m" };
const verbs = (calls: string[][]) => calls.map((call) => call[1]);

test("a release that never deployed is uninstalled and its absence verified", async () => {
  const repository = await loadRepository("local");
  const { runner, calls } = helm([{ revision: 1, status: "failed" }]);
  await expect(recoverRelease(repository, runner, target)).resolves.toBe(
    "uninstalled",
  );
  expect(verbs(calls)).toEqual(["history", "uninstall", "history"]);
});

test("recovery fails naming the release when the uninstall left it behind", async () => {
  const repository = await loadRepository("local");
  const { runner } = helm([{ revision: 1, status: "failed" }], true);
  await expect(recoverRelease(repository, runner, target)).rejects.toThrow(
    /release reference in namespace reference is still present after uninstall/,
  );
});

test.each(["pending-upgrade", "pending-rollback"])(
  "a canceled %s returns to the last deployed revision instead of uninstalling",
  async (status) => {
    const repository = await loadRepository("local");
    const { runner, calls } = helm([
      { revision: 1, status: "superseded" },
      { revision: 2, status: "deployed" },
      { revision: 3, status },
    ]);
    await expect(recoverRelease(repository, runner, target)).resolves.toBe(
      "rolled-back",
    );
    expect(verbs(calls)).toEqual(["history", "rollback", "history"]);
    expect(calls[1]).toEqual(
      expect.arrayContaining(["reference", "2", "--wait"]),
    );
    expect(calls.some((call) => call[1] === "uninstall")).toBe(false);
  },
);

test("a deployed release, even after a failed upgrade, is left to helm", async () => {
  const repository = await loadRepository("local");
  const { runner, calls } = helm([
    { revision: 1, status: "deployed" },
    { revision: 2, status: "failed" },
  ]);
  await expect(recoverRelease(repository, runner, target)).resolves.toBe(
    "none",
  );
  expect(verbs(calls)).toEqual(["history"]);
});

test("a missing release needs nothing", async () => {
  const repository = await loadRepository("local");
  const { runner } = helm(undefined);
  await expect(recoverRelease(repository, runner, target)).resolves.toBe(
    "none",
  );
});

test("the guard runs before anything is uninstalled and can refuse", async () => {
  const repository = await loadRepository("local");
  const { runner, calls } = helm([{ revision: 1, status: "failed" }]);
  await expect(
    recoverRelease(repository, runner, target, async () => {
      throw new Error("retained data exists");
    }),
  ).rejects.toThrow(/retained data exists/);
  expect(calls.some((call) => call[1] === "uninstall")).toBe(false);
});
