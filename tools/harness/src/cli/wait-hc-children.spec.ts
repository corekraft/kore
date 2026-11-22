import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDeps } from "../runtime/index.js";
import { hcSessionsOn, terminalsFor } from "../session/index.js";
import type { Terminals } from "../terminal/index.js";
import { CHECKS_POLL_MS } from "./pr-checks.js";
import {
  childrenPause,
  hcChildrenFor,
  pollPause,
  startPrWatchers,
  stopWatchers,
  watchOnChildren,
  withPause,
  type Pause,
} from "./wait-hc-children.js";

vi.mock("../session/index.js", () => ({
  hcSessionsOn: vi.fn(),
  terminalsFor: vi.fn(),
}));

const T0 = Date.parse("2026-01-02T03:04:05.000Z");
const PLACE = { root: "/repo", repo: "corekraft/kore" };

/** A clock that moves only when the wait or the sleep moves it, so the bound is measured without a timer. */
function clockAt() {
  let elapsed = 0;
  const sleep = vi.fn((ms: number) => {
    elapsed += ms;
    return Promise.resolve();
  });
  const clock = { now: () => new Date(T0 + elapsed), sleep };
  return { clock, sleep, advance: (ms: number) => (elapsed += ms) };
}

function terminalsMock() {
  return {
    self: vi.fn((): string | undefined => "t1"),
    run: vi.fn(),
    wait: vi.fn(),
    kill: vi.fn(),
  };
}
type TerminalsMock = ReturnType<typeof terminalsMock>;

const asTerminals = (terminals: TerminalsMock) =>
  terminals as unknown as Terminals;

/** The caller as hc-sessions and the terminal see it: whether hc is on, and the caller's own terminal id. */
function hcCaller(on: boolean): TerminalsMock {
  vi.mocked(hcSessionsOn).mockResolvedValue(on);
  const terminals = terminalsMock();
  vi.mocked(terminalsFor).mockReturnValue(asTerminals(terminals));
  return terminals;
}

/** A pause on the caller's children, for a terminal whose wait the test sets. */
const pauseOf = (terminals: TerminalsMock) =>
  childrenPause({
    terminals: asTerminals(terminals),
    self: "t1",
    clock: clockAt().clock,
  });

beforeEach(() => {
  vi.resetAllMocks();
});

describe("hcChildrenFor: the children wait runs only for a --pr target on hc-sessions, from an hc terminal", () => {
  it("is absent when hc-sessions is off, so the loop keeps polling", async () => {
    hcCaller(false);
    expect(await hcChildrenFor({} as CliDeps, { prs: [5], ideas: 0 })).toBe(
      undefined,
    );
  });

  it("is absent when the wait names an idea, which keeps the loop", async () => {
    hcCaller(true);
    expect(await hcChildrenFor({} as CliDeps, { prs: [5], ideas: 1 })).toBe(
      undefined,
    );
  });

  it("is absent when no pull request is named", async () => {
    hcCaller(true);
    expect(await hcChildrenFor({} as CliDeps, { prs: [], ideas: 0 })).toBe(
      undefined,
    );
  });

  it("is absent when the caller is not an hc terminal, since no child can be started", async () => {
    hcCaller(true).self.mockReturnValue(undefined);
    expect(await hcChildrenFor({} as CliDeps, { prs: [5], ideas: 0 })).toBe(
      undefined,
    );
  });

  it("is the caller's terminals and terminal id when hc-sessions is on and a pull request is named", async () => {
    const terminals = hcCaller(true);
    expect(await hcChildrenFor({} as CliDeps, { prs: [5], ideas: 0 })).toEqual({
      terminals: asTerminals(terminals),
      self: "t1",
    });
  });
});

describe("withPause: the wait runs on the caller's children on hc, and on the checks' poll interval otherwise", () => {
  it("runs with the poll pause, and starts no watcher, when the caller has no hc children", async () => {
    const terminals = hcCaller(false);
    const { clock, sleep } = clockAt();
    const run = vi.fn(async (pause: Pause) =>
      (await pause(CHECKS_POLL_MS + 1)) ? 1 : 0,
    );

    const deps = { clock, stderr: vi.fn() } as unknown as CliDeps;
    expect(await withPause(deps, { prs: [5], ideas: 0 }, PLACE, run)).toBe(0);
    expect(sleep).toHaveBeenCalledExactlyOnceWith(CHECKS_POLL_MS);
    expect(terminals.run).not.toHaveBeenCalled();
  });

  it("runs with the children pause, under the watchers of the caller's children, on hc", async () => {
    const terminals = hcCaller(true);
    terminals.run.mockResolvedValue({ id: "t7" });
    terminals.kill.mockResolvedValue({ id: "t7" });
    const deps = {
      clock: clockAt().clock,
      stderr: vi.fn(),
    } as unknown as CliDeps;

    expect(
      await withPause(deps, { prs: [5], ideas: 0 }, PLACE, async () => 0),
    ).toBe(0);
    expect(terminals.run).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ name: "pr-watch-5", parent: "t1" }),
    );
    expect(terminals.kill).toHaveBeenCalledExactlyOnceWith("t7");
  });
});

describe("startPrWatchers: one gh watcher per pull request, a child of the caller, removed when it ends", () => {
  it("runs gh pr checks --watch --fail-fast in the checkout, with no notice and removed on exit", async () => {
    const terminals = terminalsMock();
    terminals.run.mockResolvedValue({ id: "t7" });

    expect(
      await startPrWatchers(asTerminals(terminals), "t1", PLACE, [5]),
    ).toEqual(["t7"]);
    expect(terminals.run).toHaveBeenCalledExactlyOnceWith({
      argv: [
        "gh",
        "pr",
        "checks",
        "5",
        "--watch",
        "--fail-fast",
        "-R",
        "corekraft/kore",
      ],
      name: "pr-watch-5",
      cwd: "/repo",
      parent: "t1",
      notify: false,
      rm: true,
    });
  });

  it("stops the watchers already started, and names the pull request that could not start", async () => {
    const terminals = terminalsMock();
    terminals.run.mockResolvedValueOnce({ id: "t7" }).mockResolvedValueOnce({
      error: { kind: "name-taken", message: "name pr-watch-6 is taken" },
    });
    terminals.kill.mockResolvedValue({ id: "t7" });

    await expect(
      startPrWatchers(asTerminals(terminals), "t1", PLACE, [5, 6]),
    ).rejects.toThrow("could not watch PR #6 on hc: name pr-watch-6 is taken");
    expect(terminals.kill).toHaveBeenCalledExactlyOnceWith("t7");
  });
});

describe("childrenPause: the wait on the caller's children runs for the rest of the bound", () => {
  it("passes the bound when hc's wait times out", async () => {
    const terminals = terminalsMock();
    terminals.wait.mockResolvedValue({
      error: { kind: "timeout", message: "nothing has finished" },
    });

    expect(await pauseOf(terminals)(900_000)).toBe(true);
    expect(terminals.wait).toHaveBeenCalledWith(
      { children: "any", of: "t1" },
      900_000,
    );
  });

  it("does not sleep after a wake that came after a long wait, so the checks are read at once", async () => {
    const { clock, sleep, advance } = clockAt();
    const terminals = terminalsMock();
    terminals.wait.mockImplementation(async () => {
      advance(CHECKS_POLL_MS * 4);
      return { finished: [] };
    });
    const pause = childrenPause({
      terminals: asTerminals(terminals),
      self: "t1",
      clock,
    });

    expect(await pause(900_000)).toBe(false);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("sleeps out the rest of the poll interval after a wake that came at once, so a finished child that stays listed cannot spin the loop", async () => {
    const { clock, sleep } = clockAt();
    const terminals = terminalsMock();
    terminals.wait.mockResolvedValue({ finished: [] });
    const pause = childrenPause({
      terminals: asTerminals(terminals),
      self: "t1",
      clock,
    });

    expect(await pause(900_000)).toBe(false);
    expect(sleep).toHaveBeenCalledExactlyOnceWith(CHECKS_POLL_MS);
  });

  it("passes the bound without waiting when no time remains", async () => {
    const terminals = terminalsMock();

    expect(await pauseOf(terminals)(0)).toBe(true);
    expect(terminals.wait).not.toHaveBeenCalled();
  });

  it("throws hc's message when the wait fails for another reason, so the command fails rather than reads on", async () => {
    const terminals = terminalsMock();
    terminals.wait.mockResolvedValue({
      error: {
        kind: "unavailable",
        message: "hc wait broke",
        hint: "try again",
      },
    });

    await expect(pauseOf(terminals)(900_000)).rejects.toThrow(
      "hc wait broke (try again)",
    );
  });
});

describe("pollPause: the default pause sleeps one poll interval, and passes the bound when less than one remains", () => {
  it("sleeps one poll interval and keeps polling while the bound has more than one left", async () => {
    const { clock, sleep } = clockAt();

    expect(await pollPause(clock)(CHECKS_POLL_MS + 1)).toBe(false);
    expect(sleep).toHaveBeenCalledExactlyOnceWith(CHECKS_POLL_MS);
  });

  it("passes the bound without sleeping when less than one poll interval remains", async () => {
    const { clock, sleep } = clockAt();

    expect(await pollPause(clock)(CHECKS_POLL_MS - 1)).toBe(true);
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe("stopWatchers: a watcher still running is killed, and one that ended is not an error", () => {
  it("kills each watcher it was given", async () => {
    const terminals = terminalsMock();
    terminals.kill.mockResolvedValue({ id: "x" });
    const stderr = vi.fn();

    await stopWatchers(asTerminals(terminals), ["t7", "t8"], stderr);

    expect(terminals.kill).toHaveBeenNthCalledWith(1, "t7");
    expect(terminals.kill).toHaveBeenNthCalledWith(2, "t8");
    expect(stderr).not.toHaveBeenCalled();
  });

  it("ignores a watcher that already ended and was removed", async () => {
    const terminals = terminalsMock();
    terminals.kill.mockResolvedValue({
      error: { kind: "not-found", message: "no terminal t7" },
    });
    const stderr = vi.fn();

    await stopWatchers(asTerminals(terminals), ["t7"], stderr);

    expect(stderr).not.toHaveBeenCalled();
  });

  it("names another failure to stop a watcher, without failing the wait", async () => {
    const terminals = terminalsMock();
    terminals.kill.mockResolvedValue({
      error: { kind: "unavailable", message: "kill refused" },
    });
    const stderr = vi.fn();

    await stopWatchers(asTerminals(terminals), ["t7"], stderr);

    expect(stderr).toHaveBeenCalledExactlyOnceWith(
      "could not stop the watch t7: kill refused\n",
    );
  });
});

describe("watchOnChildren: the watchers run while the wait does, and are stopped when it ends", () => {
  const deps = { clock: clockAt().clock, stderr: vi.fn() };

  it("runs the wait with a pause, and stops the watchers when it returns", async () => {
    const terminals = terminalsMock();
    terminals.run.mockResolvedValue({ id: "t7" });
    terminals.kill.mockResolvedValue({ id: "t7" });
    const run = vi.fn(async (_pause: Pause) => 0);

    expect(
      await watchOnChildren(
        { terminals: asTerminals(terminals), self: "t1" },
        deps,
        PLACE,
        [5],
        run,
      ),
    ).toBe(0);
    expect(run).toHaveBeenCalledExactlyOnceWith(expect.any(Function));
    expect(terminals.kill).toHaveBeenCalledExactlyOnceWith("t7");
  });

  it("stops the watchers even when the wait throws", async () => {
    const terminals = terminalsMock();
    terminals.run.mockResolvedValue({ id: "t7" });
    terminals.kill.mockResolvedValue({ id: "t7" });

    await expect(
      watchOnChildren(
        { terminals: asTerminals(terminals), self: "t1" },
        deps,
        PLACE,
        [5],
        async () => {
          throw new Error("hc wait broke");
        },
      ),
    ).rejects.toThrow("hc wait broke");
    expect(terminals.kill).toHaveBeenCalledExactlyOnceWith("t7");
  });
});
