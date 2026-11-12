import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { readinessFailure } from "./readiness.js";

// A loaded host (k3d's own VM during install) can make one `kubectl wait`
// miss its 3s bound. #119 is the broader fix; this retries only that timeout.

const timedOut =
  "error: timed out waiting for the condition on customresourcedefinitions/fakes.example.io";

async function subject(failures: string[]) {
  const repository = await loadRepository("local");
  const component = repository.catalog.components.find(
    ({ kind }) => kind === "helm",
  )!;
  const timeouts: string[] = [];
  const runner: Runner = {
    async run(_command, args) {
      const bound = args.find((arg) => arg.startsWith("--timeout="));
      timeouts.push(bound ?? "");
      const failure = failures[timeouts.length - 1];
      if (failure !== undefined) {
        throw new Error(failure);
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  };
  return {
    repository,
    runner,
    timeouts,
    component: { ...component, readiness: [], ownsCRDs: ["fakes.example.io"] },
  };
}

test("a status wait that times out once is retried with a longer bound and then passes", async () => {
  const { repository, runner, component, timeouts } = await subject([timedOut]);

  assert.equal(
    await readinessFailure(repository, runner, component),
    undefined,
  );
  assert.deepEqual(timeouts, ["--timeout=3s", "--timeout=15s"]);
});

test("a status wait that keeps timing out reports the resource after exactly one retry", async () => {
  const { repository, runner, component, timeouts } = await subject([
    timedOut,
    timedOut,
    timedOut,
  ]);

  const failure = await readinessFailure(repository, runner, component);

  assert.match(
    failure ?? "",
    /crd\/fakes\.example\.io not ready \(Established\)/,
  );
  assert.equal(timeouts.length, 2);
});

test("an error that is not a timeout is not retried", async () => {
  const { repository, runner, component, timeouts } = await subject([
    "error: the condition Established is not available on this resource",
  ]);

  const failure = await readinessFailure(repository, runner, component);

  assert.match(failure ?? "", /not available/);
  assert.equal(timeouts.length, 1);
});

test("a healthy status check stays at the short bound with one call", async () => {
  const { repository, runner, component, timeouts } = await subject([]);

  assert.equal(
    await readinessFailure(repository, runner, component),
    undefined,
  );
  assert.deepEqual(timeouts, ["--timeout=3s"]);
});
