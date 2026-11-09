import { expect, test } from "vitest";
import { loadRepository } from "../config/index.js";
import { CommandError, type Runner } from "../runtime/index.js";
import { cleanupInterruptedReleases } from "./cleanup.js";

type Revision = { revision: number; status: string };

/** Helm and kubectl as an interrupted `app up` left them. */
function cluster(
  releases: Record<string, Revision[]>,
  retained = "",
): { runner: Runner; calls: string[][] } {
  const calls: string[][] = [];
  const state = structuredClone(releases);
  const runner: Runner = {
    async run(command, args) {
      calls.push([command, ...args]);
      if (command === "helm" && args[0] === "history") {
        const revisions = state[args[1]!];
        if (!revisions) {
          throw new CommandError(command, args, {
            stdout: "",
            stderr: "Error: release: not found",
            code: 1,
          });
        }
        return { stdout: JSON.stringify(revisions), stderr: "", code: 0 };
      }
      if (command === "helm" && args[0] === "uninstall") {
        delete state[args[1]!];
      }
      if (
        command === "kubectl" &&
        args.includes("postgresqlinstances.platform.kore.dev")
      ) {
        return { stdout: retained, stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  };
  return { runner, calls };
}
const uninstalled = (calls: string[][]) =>
  calls.filter((c) => c[1] === "uninstall").map((c) => c[2]);

test("a failed first workload install is uninstalled while the healthy resources release is untouched", async () => {
  const repository = await loadRepository("local");
  const { runner, calls } = cluster({
    "reference-resources": [{ revision: 1, status: "deployed" }],
    reference: [{ revision: 1, status: "failed" }],
  });
  await cleanupInterruptedReleases(repository, runner, "reference");
  expect(uninstalled(calls)).toEqual(["reference"]);
});

test("nothing is uninstalled when both releases are healthy or absent", async () => {
  const repository = await loadRepository("local");
  const { runner, calls } = cluster({
    reference: [{ revision: 1, status: "deployed" }],
  });
  await cleanupInterruptedReleases(repository, runner, "reference");
  expect(uninstalled(calls)).toEqual([]);
});

test("a never-deployed resources release is not uninstalled while retained data exists", async () => {
  const repository = await loadRepository("local");
  const { runner, calls } = cluster(
    { "reference-resources": [{ revision: 1, status: "failed" }] },
    "postgresqlinstance.platform.kore.dev/reference-db\n",
  );
  await expect(
    cleanupInterruptedReleases(repository, runner, "reference"),
  ).rejects.toThrow(/retained data.*postgresqlinstance.*reference-db/s);
  expect(uninstalled(calls)).toEqual([]);
});

test("a never-deployed resources release with no retained data is cleaned up", async () => {
  const repository = await loadRepository("local");
  const { runner, calls } = cluster({
    "reference-resources": [{ revision: 1, status: "pending-install" }],
  });
  await cleanupInterruptedReleases(repository, runner, "reference");
  expect(uninstalled(calls)).toEqual(["reference-resources"]);
});

test("cleanup reads and writes only the application's own releases, always with the configured context", async () => {
  const repository = await loadRepository("local");
  const { runner, calls } = cluster({
    reference: [{ revision: 1, status: "failed" }],
  });
  await cleanupInterruptedReleases(repository, runner, "reference");
  for (const call of calls) {
    expect(call).toContain(repository.environment.kubeContext);
  }
  expect(
    calls.filter((c) => c[0] === "helm").every((c) => c.includes("reference")),
  ).toBe(true);
});
