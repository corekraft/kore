import { expect, test } from "vitest";
import { CommandError, type Runner } from "../runtime/index.js";
import { recoverRelease } from "./release-recovery.js";
import { fakeRepository } from "./platform-support.js";

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
const repository = fakeRepository();

test("a release that never deployed is uninstalled and its absence verified", async () => {
  const { runner, calls } = helm([{ revision: 1, status: "failed" }]);
  await expect(recoverRelease(repository, runner, target)).resolves.toBe(
    "uninstalled",
  );
  expect(verbs(calls)).toEqual(["history", "uninstall", "history"]);
});

test("recovery fails naming the release when the uninstall left it behind", async () => {
  const { runner } = helm([{ revision: 1, status: "failed" }], true);
  await expect(recoverRelease(repository, runner, target)).rejects.toThrow(
    /release reference in namespace reference is still present after uninstall/,
  );
});

test.each(["pending-upgrade", "pending-rollback"])(
  "a canceled %s returns to the last deployed revision instead of uninstalling",
  async (status) => {
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

const canceledUpgrade: Revision[] = [
  { revision: 1, status: "superseded" },
  { revision: 2, status: "deployed" },
  { revision: 3, status: "pending-upgrade" },
];
const argocdOwned = { ...target, owner: "argocd" as const };
const argocdFlagOn = fakeRepository({
  features: { "platform-argocd-delivery": true },
});

test("a canceled upgrade of a release Argo CD owns is refused, naming its git revert, and no helm rollback runs", async () => {
  const { runner, calls } = helm(canceledUpgrade);
  await expect(
    recoverRelease(argocdFlagOn, runner, argocdOwned),
  ).rejects.toThrow(
    /release reference in namespace reference is owned by Argo CD.*git revert of its record in infra\/catalog\/components\.yaml.*platform-argocd-delivery/s,
  );
  expect(verbs(calls)).toEqual(["history"]);
  expect(calls.some((call) => call[1] === "rollback")).toBe(false);
});

test("an argocd-named release is still rolled back by kore while platform-argocd-delivery is off, since kore owns it then", async () => {
  const { runner, calls } = helm(canceledUpgrade);
  await expect(recoverRelease(repository, runner, argocdOwned)).resolves.toBe(
    "rolled-back",
  );
  expect(verbs(calls)).toEqual(["history", "rollback", "history"]);
});

test("a release kore owns is rolled back as before while platform-argocd-delivery is on", async () => {
  const { runner, calls } = helm(canceledUpgrade);
  await expect(
    recoverRelease(argocdFlagOn, runner, { ...target, owner: "kore" }),
  ).resolves.toBe("rolled-back");
  expect(verbs(calls)).toEqual(["history", "rollback", "history"]);
});

test("a deployed release, even after a failed upgrade, is left to helm", async () => {
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
  const { runner } = helm(undefined);
  await expect(recoverRelease(repository, runner, target)).resolves.toBe(
    "none",
  );
});

test("the guard runs before anything is uninstalled and can refuse", async () => {
  const { runner, calls } = helm([{ revision: 1, status: "failed" }]);
  await expect(
    recoverRelease(repository, runner, target, async () => {
      throw new Error("retained data exists");
    }),
  ).rejects.toThrow(/retained data exists/);
  expect(calls.some((call) => call[1] === "uninstall")).toBe(false);
});

test("a history failure other than a missing release is rethrown, never read as no release", async () => {
  const runner: Runner = {
    async run(command, args) {
      throw new CommandError(command, args, {
        stdout: "",
        stderr: "connection refused",
        code: 1,
      });
    },
  };
  await expect(recoverRelease(repository, runner, target)).rejects.toThrow(
    "connection refused",
  );
});

test("a canceled upgrade with no earlier live revision is left to helm", async () => {
  const { runner, calls } = helm([
    { revision: 1, status: "failed" },
    { revision: 2, status: "pending-upgrade" },
  ]);
  await expect(recoverRelease(repository, runner, target)).resolves.toBe(
    "none",
  );
  expect(verbs(calls)).toEqual(["history"]);
});

test("a rollback that does not leave the release deployed fails naming the revision it rolled back to", async () => {
  const history: Revision[] = [
    { revision: 1, status: "superseded" },
    { revision: 2, status: "deployed" },
    { revision: 3, status: "pending-upgrade" },
  ];
  const runner: Runner = {
    async run(_command, args) {
      const stdout = args[0] === "history" ? JSON.stringify(history) : "";
      return { stdout, stderr: "", code: 0 };
    },
  };
  await expect(recoverRelease(repository, runner, target)).rejects.toThrow(
    /not deployed after rolling back to revision 2/,
  );
});
