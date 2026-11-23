import { expect, test, vi } from "vitest";
import { CommandError, type Runner } from "../runtime/index.js";
import { n1Check, type N1Inputs } from "./n1-check.js";

// The check runs through the injected runner only, so these tests script each step's outcome and
// observe the calls, the environment they get and the failures they produce (ADR 0098).
// A bare placeholder: the redaction only needs a string to find, never a real connection string.
const URL = "scratch-database-placeholder";
const dir = "/work/leads";
const baseEnv = { PATH: "/usr/bin" };

const complete = (runner: Runner): N1Inputs => ({
  runner,
  dir,
  baseEnv,
  apply: "/eval/apply-migrations",
  previousSuite: "/eval/previous-suite",
  databaseUrl: URL,
});

/** A runner whose calls get the next scripted outcome: "ok" for a passing step, or a rejection. */
function scripted(...outcomes: ("ok" | Error)[]) {
  const run = vi.fn<Runner["run"]>();
  for (const outcome of outcomes) {
    if (outcome === "ok") {
      run.mockResolvedValueOnce({ stdout: "", stderr: "", code: 0 });
    } else {
      run.mockRejectedValueOnce(outcome);
    }
  }
  return { run } satisfies Runner;
}

const failed = (
  command: string,
  stderr: string,
  stdout = "",
  code = 1,
): CommandError => new CommandError(command, [], { stdout, stderr, code });

test("without the three inputs the check fails, names all three, and runs nothing", async () => {
  expect(await n1Check(undefined)).toEqual([
    "the N-1 check needs --n1-apply <executable>, --n1-previous-suite <executable> and KORE_EVAL_SCRATCH_DATABASE_URL; missing: --n1-apply, --n1-previous-suite, KORE_EVAL_SCRATCH_DATABASE_URL",
  ]);
});

test("a missing input is named, and the others are not reported as missing", async () => {
  const runner = scripted();
  expect(
    await n1Check({ ...complete(runner), previousSuite: undefined }),
  ).toEqual([
    "the N-1 check needs --n1-apply <executable>, --n1-previous-suite <executable> and KORE_EVAL_SCRATCH_DATABASE_URL; missing: --n1-previous-suite",
  ]);
  expect(runner.run).not.toHaveBeenCalled();
});

test("both steps pass in order, each in the app directory with the scratch URL in its environment", async () => {
  const runner = scripted("ok", "ok");
  expect(await n1Check(complete(runner))).toEqual([]);
  expect(runner.run).toHaveBeenNthCalledWith(1, "/eval/apply-migrations", [], {
    cwd: dir,
    env: { PATH: "/usr/bin", DATABASE_URL: URL },
  });
  expect(runner.run).toHaveBeenNthCalledWith(2, "/eval/previous-suite", [], {
    cwd: dir,
    env: { PATH: "/usr/bin", DATABASE_URL: URL },
  });
});

test("a failing apply step fails the check, names the step, and never runs the previous suite", async () => {
  const runner = scripted(
    failed("/eval/apply-migrations", "relation notes exists\n"),
  );
  expect(await n1Check(complete(runner))).toEqual([
    "N-1 check: applying the new migrations failed (exit 1): relation notes exists",
  ]);
  expect(runner.run).toHaveBeenCalledTimes(1);
});

test("a failing previous-suite step fails the check, naming the suite, not the migrations", async () => {
  const runner = scripted(
    "ok",
    failed("/eval/previous-suite", "", "3 tests failed\n", 2),
  );
  expect(await n1Check(complete(runner))).toEqual([
    "N-1 check: the previous release's suite failed (exit 2): 3 tests failed",
  ]);
});

test("the failure shows stdout when stderr is empty, and says so when both are empty", async () => {
  expect(
    await n1Check(
      complete(
        scripted(failed("/eval/apply-migrations", "", "lock timeout\n")),
      ),
    ),
  ).toEqual([
    "N-1 check: applying the new migrations failed (exit 1): lock timeout",
  ]);
  expect(
    await n1Check(complete(scripted(failed("/eval/apply-migrations", "")))),
  ).toEqual([
    "N-1 check: applying the new migrations failed (exit 1): no output",
  ]);
});

test("the scratch database URL appears in neither the failure nor anything else the check reports", async () => {
  const runner = scripted(
    failed("/eval/apply-migrations", `could not connect to ${URL}: refused`),
  );
  const failures = await n1Check(complete(runner));
  expect(failures).toEqual([
    "N-1 check: applying the new migrations failed (exit 1): could not connect to <redacted>: refused",
  ]);
  expect(JSON.stringify(failures)).not.toContain(
    "scratch-database-placeholder",
  );
});

test("an error that is not a failed command, such as a missing runner, is not swallowed", async () => {
  const runner = scripted(new Error("spawn /eval/apply-migrations ENOENT"));
  await expect(n1Check(complete(runner))).rejects.toThrow(
    "spawn /eval/apply-migrations ENOENT",
  );
});
