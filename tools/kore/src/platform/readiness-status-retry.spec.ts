import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { readinessFailure } from "./readiness.js";
import { retryBudget } from "./readiness-poll.js";

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

test("one status run spends the 15s retry once, however many components are not ready", async () => {
  const { repository, runner, component, timeouts } = await subject(
    Array<string>(20).fill(timedOut),
  );
  const budget = retryBudget();

  const first = await readinessFailure(repository, runner, component, budget);
  const second = await readinessFailure(repository, runner, component, budget);
  const third = await readinessFailure(repository, runner, component, budget);

  for (const failure of [first, second, third]) {
    assert.match(failure ?? "", /not ready/);
  }
  assert.deepEqual(timeouts, [
    "--timeout=3s",
    "--timeout=15s",
    "--timeout=3s",
    "--timeout=3s",
  ]);
});

test("a not-ready Deployment costs 3s plus one 15s retry for the whole status run", async () => {
  const { repository, runner, component, timeouts } = await subject(
    Array<string>(20).fill(timedOut),
  );
  const budget = retryBudget();
  const deployment = {
    ...component,
    readiness: ["deployment/web"],
    ownsCRDs: [],
  };

  for (let i = 0; i < 4; i++) {
    await readinessFailure(repository, runner, deployment, budget);
  }

  assert.equal(timeouts.filter((t) => t === "--timeout=15s").length, 1);
});

test("a slow but ready component does not spend the retry budget", async () => {
  const { repository, runner, component, timeouts } = await subject([timedOut]);
  const budget = retryBudget();

  // First component: 3s times out, the 15s retry passes (runner succeeds).
  assert.equal(
    await readinessFailure(repository, runner, component, budget),
    undefined,
  );
  assert.equal(budget.spent, false);
  assert.deepEqual(timeouts, ["--timeout=3s", "--timeout=15s"]);
});

test("a ready-but-slow component after a broken one still keeps its retry only while the budget is unspent", async () => {
  const { repository, runner, component, timeouts } = await subject([
    timedOut,
    timedOut,
    timedOut,
    "",
  ]);
  const budget = retryBudget();

  await readinessFailure(repository, runner, component, budget);
  assert.equal(budget.spent, true);
  await readinessFailure(repository, runner, component, budget);

  assert.deepEqual(timeouts, ["--timeout=3s", "--timeout=15s", "--timeout=3s"]);
});
