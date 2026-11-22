// The harness entry point: it hands the command line to the CLI with the real runtime adapters
// and turns the outcome into the process exit code. Its imports are the CLI and runtime barrels, both mocked.
// Docs: infra/plans/14-test-tiers.md#step-1-foundations

import { afterEach, beforeEach, expect, test, vi } from "vitest";

const runtime = vi.hoisted(() => {
  class ProcessRunnerDouble {}
  return {
    ProcessRunnerDouble,
    clock: { tag: "clock" },
    fs: { tag: "fs" },
    ids: { tag: "ids" },
    hostLoad: { tag: "hostLoad" },
    links: { tag: "links" },
  };
});

vi.mock("./cli/index.js", () => ({ run: vi.fn() }));
vi.mock("./runtime/index.js", () => ({
  ProcessRunner: runtime.ProcessRunnerDouble,
  nodeFileSystem: runtime.fs,
  nodeLinks: runtime.links,
  readStdin: vi.fn(),
  resolveRoot: vi.fn(),
  systemClock: runtime.clock,
  systemHostLoad: runtime.hostLoad,
  systemIds: runtime.ids,
}));

const savedArgv = process.argv;
const savedExitCode = process.exitCode;
let stderr: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  process.exitCode = undefined;
  stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
});

afterEach(() => {
  process.argv = savedArgv;
  process.exitCode = savedExitCode;
});

/** Imports the entry point fresh, with the command line and the CLI's outcome set beforehand. */
async function startHarness(argv: string[], outcome: () => Promise<number>) {
  process.argv = ["node", "/bundle/harness.mjs", ...argv];
  vi.resetModules();
  const cli = await import("./cli/index.js");
  vi.mocked(cli.run).mockImplementation(outcome);
  await import("./main.js");
  return vi.mocked(cli.run);
}

test("the entry point hands the CLI the arguments after the script name", async () => {
  const run = await startHarness(["session", "notify", "w3:p1"], async () => 0);

  expect(run).toHaveBeenCalledTimes(1);
  expect(run.mock.calls[0]?.[0]).toEqual(["session", "notify", "w3:p1"]);
});

test("the entry point wires the real runtime adapters, the environment and the working directory into the CLI", async () => {
  const run = await startHarness(["plan"], async () => 0);

  expect(run).toHaveBeenCalledWith(
    ["plan"],
    expect.objectContaining({
      runner: expect.any(runtime.ProcessRunnerDouble),
      clock: runtime.clock,
      fs: runtime.fs,
      ids: runtime.ids,
      hostLoad: runtime.hostLoad,
      links: runtime.links,
      bundleUrl: expect.stringMatching(/\/main\.ts$/),
      env: process.env,
      cwd: process.cwd(),
    }),
  );
});

test("the process exits with the code the CLI returns", async () => {
  await startHarness(["hook", "guard"], async () => 3);

  expect(process.exitCode).toBe(3);
  expect(stderr).not.toHaveBeenCalled();
});

test("the process exits 0 when the CLI succeeds", async () => {
  await startHarness(["kb", "check"], async () => 0);

  expect(process.exitCode).toBe(0);
});

test("a thrown error prints its message alone to stderr and exits 1", async () => {
  await startHarness(["bogus"], () =>
    Promise.reject(new Error("unknown command: bogus")),
  );

  expect(stderr).toHaveBeenCalledWith("unknown command: bogus\n");
  expect(process.exitCode).toBe(1);
});

test("a rejection that is not an Error prints its text to stderr and exits 1", async () => {
  await startHarness(["bogus"], () => Promise.reject("plain failure"));

  expect(stderr).toHaveBeenCalledWith("plain failure\n");
  expect(process.exitCode).toBe(1);
});
