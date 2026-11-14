import { beforeEach, expect, test, vi } from "vitest";
import { loadRepository } from "../config/index.js";
import {
  ProcessRunner,
  withHelmDeadline,
  withRequestTimeout,
  withTransientRetry,
} from "../runtime/index.js";
import { main } from "./cli.js";
import { COMMANDS, isMutating } from "./commands.js";
import type { CommandSpec } from "./context.js";
import {
  boolFlag,
  parseArgs,
  requireEnvironment,
  stringFlag,
} from "./flags.js";
import { createMutate } from "./mutation.js";
import { fakeRepository, parsedArgs } from "./cli-support.js";

// The table is a constant to the cli; the spec fills its own copy of it.
const table = COMMANDS as Map<string, CommandSpec>;

// The command table is a constant; the spec replaces it with an empty one and
// fills it per test. Each collaborator is a typed automock.
vi.mock("./commands.js", () => ({
  COMMANDS: new Map<string, CommandSpec>(),
  isMutating: vi.fn(),
  usage: "USAGE",
}));
vi.mock("../config/index.js");
vi.mock("../runtime/index.js");
vi.mock("./flags.js");
vi.mock("./mutation.js");

const repository = fakeRepository();
const mutate = vi.fn();
const run = vi.fn<CommandSpec["run"]>(async () => 0);

beforeEach(() => {
  table.clear();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.mocked(parseArgs).mockReturnValue(parsedArgs());
  vi.mocked(stringFlag).mockReturnValue(undefined);
  vi.mocked(boolFlag).mockReturnValue(false);
  vi.mocked(requireEnvironment).mockReturnValue("staging");
  vi.mocked(isMutating).mockReturnValue(false);
  vi.mocked(loadRepository).mockResolvedValue(repository);
  vi.mocked(withRequestTimeout).mockImplementation((runner) => runner);
  vi.mocked(withHelmDeadline).mockImplementation((runner) => runner);
  vi.mocked(withTransientRetry).mockImplementation((runner) => runner);
  vi.mocked(createMutate).mockReturnValue(mutate);
  run.mockResolvedValue(0);
  table.set("cluster", { mutations: ["up"], run });
});

test("no command, help, and --help print the usage and exit 0 without loading an environment", async () => {
  for (const argv of [[], ["help"], ["--help"]]) {
    expect(await main(argv)).toBe(0);
  }
  expect(console.log).toHaveBeenCalledTimes(3);
  expect(vi.mocked(console.log).mock.calls.map((call) => call[0])).toEqual([
    "USAGE",
    "USAGE",
    "USAGE",
  ]);
  expect(loadRepository).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});

test("an unknown command loads the default environment, then refuses with the usage", async () => {
  await expect(main(["nope"])).rejects.toThrow(
    "unknown command: nope\n\nUSAGE",
  );
  expect(loadRepository).toHaveBeenCalledWith("local");
});

test("an unknown command loads the environment named by --environment before it refuses", async () => {
  vi.mocked(stringFlag).mockReturnValue("staging");
  await expect(main(["nope", "--environment", "staging"])).rejects.toThrow(
    "unknown command: nope",
  );
  expect(loadRepository).toHaveBeenCalledWith("staging");
});

test("a mutating action runs the command in the environment named by --environment", async () => {
  vi.mocked(isMutating).mockReturnValue(true);
  expect(await main(["cluster", "up", "--environment", "staging"])).toBe(0);
  expect(isMutating).toHaveBeenCalledWith(COMMANDS.get("cluster"), "up");
  expect(loadRepository).toHaveBeenCalledWith("staging");
  expect(run).toHaveBeenCalledWith(
    expect.objectContaining({ environmentName: "staging" }),
  );
});

test("a mutating action with no --environment is refused before any environment is loaded", async () => {
  vi.mocked(isMutating).mockReturnValue(true);
  vi.mocked(requireEnvironment).mockImplementation(() => {
    throw new Error("--environment is required for mutating commands");
  });
  await expect(main(["cluster", "up"])).rejects.toThrow(
    "--environment is required for mutating commands",
  );
  expect(loadRepository).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});

test("a read-only action defaults to the local environment and never asks for --environment", async () => {
  expect(await main(["cluster", "status"])).toBe(0);
  expect(requireEnvironment).not.toHaveBeenCalled();
  expect(loadRepository).toHaveBeenCalledWith("local");
});

test("a command with no action reads its arguments after the command name only", async () => {
  table.set("doctor", { mutations: [], noAction: true, run });
  await main(["doctor", "--json"]);
  expect(parseArgs).toHaveBeenCalledWith(["--json"]);
});

test("a command with an action reads its arguments after the command and action", async () => {
  await main(["cluster", "status", "--json"]);
  expect(parseArgs).toHaveBeenCalledWith(["--json"]);
});

test("the runner is a process runner with a 30 minute command timeout, wrapped by the kubectl timeout, Helm deadline and transient retry", async () => {
  await main(["cluster", "status"]);
  const instance = vi.mocked(ProcessRunner).mock.instances[0];
  expect(ProcessRunner).toHaveBeenCalledWith({
    defaultTimeoutMs: 30 * 60_000,
  });
  expect(withRequestTimeout).toHaveBeenCalledWith(instance, "30s");
  expect(withHelmDeadline).toHaveBeenCalledWith(instance);
  expect(withTransientRetry).toHaveBeenCalledWith(instance);
  expect(run).toHaveBeenCalledWith(
    expect.objectContaining({ runner: instance }),
  );
});

test("the command receives its mutate built from its table entry and the resolved environment", async () => {
  vi.mocked(isMutating).mockReturnValue(true);
  await main(["cluster", "up", "--environment", "staging"]);
  expect(createMutate).toHaveBeenCalledWith({
    command: "cluster",
    action: "up",
    mutations: ["up"],
    environmentName: "staging",
    repository,
    runner: vi.mocked(ProcessRunner).mock.instances[0],
  });
  expect(run).toHaveBeenCalledWith(
    expect.objectContaining({ mutate, repository }),
  );
});

test("the command receives --json as its json option, and main returns the exit code it gives", async () => {
  vi.mocked(boolFlag).mockImplementation((_parsed, name) => name === "json");
  run.mockResolvedValue(3);
  expect(await main(["cluster", "status", "--json"])).toBe(3);
  expect(boolFlag).toHaveBeenCalledWith(parsedArgs(), "json");
  expect(run).toHaveBeenCalledWith(expect.objectContaining({ json: true }));
});
