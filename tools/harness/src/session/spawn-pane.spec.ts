import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  asRegistry,
  contextOf,
  fakeDeps,
  fakeRegistry,
  type FakeDeps,
  type FakeRegistry,
} from "./deps-support.js";
import {
  describeFailure,
  equalize,
  readLayout,
  spawnedColumn,
} from "./equalize.js";
import {
  HANDOFF_TIMEOUT_MS,
  handOff,
  handoffDir,
  unreadTokenHint,
} from "./handoff.js";
import { openPane } from "./spawn-pane.js";
import { place } from "./worktree.js";

vi.mock("./equalize.js");
vi.mock("./handoff.js");
vi.mock("./worktree.js");

const CHECKED = {
  values: {
    role: "writer",
    name: "image-trust-writer",
    brief: "Do the thing.",
    model: "claude-opus-5-5",
    effort: "high",
  },
  callerPane: "w3:p1",
  timeoutMs: 60_000,
  idea: "#338",
};
const NAME_FREE = {
  stdout: "",
  stderr: '{"error":{"code":"agent_not_found","message":"not found"}}',
  code: 1,
};
const SPLIT_OK = {
  stdout: JSON.stringify({ result: { pane: { pane_id: "w3:p9" } } }),
  stderr: "",
  code: 0,
};
const LEFT_OPEN =
  "The pane w3:p9 was left open; close it with `herdr pane close w3:p9`.";
const TAKEN =
  "A session named image-trust-writer already exists; pick another name or close that session first. No pane was split.";

let deps: FakeDeps;
let registry: FakeRegistry;

/** Answers `herdr agent get` as free, and every split as the given reply. */
function herdr(split = SPLIT_OK): void {
  deps.runner.run.mockImplementation((_command, args) =>
    Promise.resolve(args[1] === "get" ? NAME_FREE : split),
  );
}

/** Opens the pane over the shared deps and the fake registry, with the token given or not. */
function open(token?: string) {
  return openPane(contextOf(deps), CHECKED, asRegistry(registry), token);
}

beforeEach(() => {
  deps = fakeDeps();
  registry = fakeRegistry();
  registry.unavailable.mockResolvedValue(undefined);
  herdr();
  vi.mocked(place).mockResolvedValue({ cwd: "/repo", left: "" });
  vi.mocked(readLayout).mockResolvedValue({
    layout: { panes: [], splits: [] },
  });
  vi.mocked(spawnedColumn).mockReturnValue([]);
  vi.mocked(equalize).mockResolvedValue({ status: "equalized" });
  vi.mocked(describeFailure).mockImplementation((result) => result.stderr);
  vi.mocked(handoffDir).mockResolvedValue("/handoff/image-trust-writer");
  vi.mocked(handOff).mockResolvedValue(undefined);
  vi.mocked(unreadTokenHint).mockImplementation((error) => `hint: ${error}`);
});

describe("openPane refuses a name in use, before anything is split", () => {
  it("refuses a name the registry says is open, with the registry's reason", async () => {
    registry.unavailable.mockResolvedValue(TAKEN);

    await expect(open()).resolves.toEqual({ error: TAKEN });
    expect(registry.unavailable).toHaveBeenCalledWith("image-trust-writer");
    expect(deps.runner.run).not.toHaveBeenCalled();
    expect(place).not.toHaveBeenCalled();
  });

  it("refuses a name herdr already runs as an agent", async () => {
    deps.runner.run.mockResolvedValue({ stdout: "", stderr: "", code: 0 });

    await expect(open()).resolves.toEqual({
      error:
        "A session named image-trust-writer already exists; pick another name or close that session first. No pane was split.",
    });
    expect(place).not.toHaveBeenCalled();
  });

  it("names the herdr failure when the name cannot be checked", async () => {
    deps.runner.run.mockResolvedValue({
      stdout: "",
      stderr: "socket closed",
      code: 1,
    });

    await expect(open()).resolves.toEqual({
      error: "herdr agent get failed: socket closed. No pane was split.",
    });
  });
});

describe("openPane places the worktree and splits the caller's pane", () => {
  it("returns the placement's error, and splits nothing, when the placement fails", async () => {
    vi.mocked(place).mockResolvedValue({ error: "--branch is taken." });

    await expect(open()).resolves.toEqual({ error: "--branch is taken." });
    expect(deps.runner.run).not.toHaveBeenCalledWith(
      "herdr",
      expect.arrayContaining(["split"]),
      expect.anything(),
    );
  });

  it("splits right of the caller for the first pane, stamping its agent and idea", async () => {
    await open();

    expect(deps.runner.run).toHaveBeenCalledWith("herdr", [
      "pane",
      "split",
      "--current",
      "--direction",
      "right",
      "--cwd",
      "/repo",
      "--no-focus",
      "--env",
      "KORE_AGENT=image-trust-writer",
      "--env",
      "KORE_IDEA=#338",
    ]);
  });

  it("splits down under the bottom-most spawned pane for a later one", async () => {
    vi.mocked(spawnedColumn).mockReturnValue([
      { pane_id: "w3:p4", rect: { x: 50, y: 0 } },
      { pane_id: "w3:p5", rect: { x: 50, y: 10 } },
    ]);

    await open();

    expect(deps.runner.run).toHaveBeenCalledWith(
      "herdr",
      expect.arrayContaining(["pane", "split", "w3:p5", "--direction", "down"]),
    );
  });

  it("refuses, leaving the placement's note, when the caller's layout cannot be read", async () => {
    vi.mocked(place).mockResolvedValue({
      cwd: "/repo",
      left: " Worktree kept at /x.",
    });
    vi.mocked(readLayout).mockResolvedValue({
      error: "herdr pane layout failed",
    });

    await expect(open()).resolves.toEqual({
      error:
        "herdr pane layout failed. No pane was split. Worktree kept at /x.",
    });
  });

  it("refuses with herdr's split failure when the split fails", async () => {
    herdr({ stdout: "", stderr: "no room", code: 1 });

    await expect(open()).resolves.toEqual({
      error: "herdr pane split failed: no room",
    });
  });

  it("refuses, quoting herdr's reply, when the split returns no pane id", async () => {
    herdr({ stdout: '{"result":{}}', stderr: "", code: 0 });

    await expect(open()).resolves.toEqual({
      error:
        'herdr pane split did not return a pane id (.result.pane.pane_id): {"result":{}}',
    });
  });
});

describe("openPane settles the layout and hands the token over", () => {
  it("fails, naming the pane left open, when the caller's column cannot be equalized", async () => {
    vi.mocked(equalize).mockResolvedValue({
      status: "failed",
      reason: "equalize failed",
    });

    await expect(open()).resolves.toEqual({
      error: `equalize failed. ${LEFT_OPEN}`,
    });
  });

  it("hands the token to the new pane, and explains a failed start with the token hint", async () => {
    const result = await open("ghs_writer");

    expect(handoffDir).toHaveBeenCalledWith(deps, "image-trust-writer");
    expect(handOff).toHaveBeenCalledWith(deps, {
      dir: "/handoff/image-trust-writer",
      pane: "w3:p9",
      token: "ghs_writer",
      timeoutMs: HANDOFF_TIMEOUT_MS,
    });
    expect(result).toMatchObject({ paneId: "w3:p9" });
    expect("explain" in result && result.explain("agent start failed")).toBe(
      "hint: agent start failed",
    );
  });

  it("fails, naming the pane left open, when the token cannot be handed over", async () => {
    vi.mocked(handOff).mockResolvedValue("the FIFO was not read");

    await expect(open("ghs_writer")).resolves.toEqual({
      error: `the FIFO was not read ${LEFT_OPEN}`,
    });
  });

  it("hands over nothing and keeps a plain explanation when no token is given", async () => {
    const result = await open();

    expect(handoffDir).not.toHaveBeenCalled();
    expect(handOff).not.toHaveBeenCalled();
    if (!("explain" in result)) {
      throw new Error("expected an open pane");
    }
    expect(result.explain("agent start failed")).toBe("agent start failed");
  });
});

describe("openPane returns the open pane", () => {
  it("returns the pane id, what to say if it is left open, and the placement", async () => {
    vi.mocked(place).mockResolvedValue({ cwd: "/repo", left: "" });

    const result = await open();

    expect(result).toMatchObject({
      paneId: "w3:p9",
      leftOpen: LEFT_OPEN,
      placed: { cwd: "/repo", left: "" },
    });
  });
});
