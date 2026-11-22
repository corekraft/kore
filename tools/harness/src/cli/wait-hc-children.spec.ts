import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDeps } from "../runtime/index.js";
import { hcSessionsOn, terminalsFor } from "../session/index.js";
import type { Terminal, Terminals } from "../terminal/index.js";
import { CHECKS_POLL_MS } from "./pr-checks.js";
import {
  hcChildrenFor,
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

/** A clock that moves only when the sleep moves it, so a wait is measured without a timer. */
function clockAt() {
  let elapsed = 0;
  const sleep = vi.fn((ms: number) => {
    elapsed += ms;
    return Promise.resolve();
  });
  return { clock: { now: () => new Date(T0 + elapsed), sleep }, sleep };
}

function terminalsMock() {
  return {
    self: vi.fn((): string | undefined => "t1"),
    list: vi.fn(async (): Promise<Terminal[]> => []),
    run: vi.fn(),
    wait: vi.fn(),
    kill: vi.fn(),
  };
}
type TerminalsMock = ReturnType<typeof terminalsMock>;

const asTerminals = (terminals: TerminalsMock) =>
  terminals as unknown as Terminals;

/** A listed child of the caller, by its id, name and state. */
function child(id: string, name: string, state: "live" | "finished"): Terminal {
  return { id, name, state, labels: {}, cwd: "/repo" };
}

/** The caller as hc-sessions and the terminal see it: whether hc is on, and the caller's own terminal. */
function hcCaller(on: boolean): TerminalsMock {
  vi.mocked(hcSessionsOn).mockResolvedValue(on);
  const terminals = terminalsMock();
  vi.mocked(terminalsFor).mockReturnValue(asTerminals(terminals));
  return terminals;
}

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
    const terminals = hcCaller(true);
    terminals.self.mockReturnValue(undefined);
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

  it("runs under the watchers of the caller's children on hc, and stops them when the wait returns", async () => {
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
      await startPrWatchers(asTerminals(terminals), "t1", PLACE, [5], vi.fn()),
    ).toEqual(["t7"]);
    expect(terminals.list).toHaveBeenCalledExactlyOnceWith({
      childrenOf: "t1",
    });
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

  it("reuses a live watcher already running for a pull request, and starts only the others", async () => {
    const terminals = terminalsMock();
    terminals.list.mockResolvedValue([child("t5", "pr-watch-5", "live")]);
    terminals.run.mockResolvedValue({ id: "t7" });

    expect(
      await startPrWatchers(
        asTerminals(terminals),
        "t1",
        PLACE,
        [5, 6],
        vi.fn(),
      ),
    ).toEqual(["t7"]);
    expect(terminals.run).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ name: "pr-watch-6" }),
    );
  });
});

describe("startPrWatchers: every name is checked before any watcher starts, and a failed start stops the rest", () => {
  it("refuses before starting any watcher when a watch of a pull request has ended but is still listed, naming the terminal to remove", async () => {
    const terminals = terminalsMock();
    terminals.list.mockResolvedValue([child("t5", "pr-watch-5", "finished")]);

    await expect(
      startPrWatchers(asTerminals(terminals), "t1", PLACE, [6, 5], vi.fn()),
    ).rejects.toThrow(
      "PR #5 has a watch that already ended, pr-watch-5 (terminal t5): remove it with hc rm t5, then wait again",
    );
    expect(terminals.run).not.toHaveBeenCalled();
  });

  it("stops the watchers already started, reporting a failure to stop on stderr, and names the pull request that could not start", async () => {
    const terminals = terminalsMock();
    terminals.run.mockResolvedValueOnce({ id: "t7" }).mockResolvedValueOnce({
      error: { kind: "name-taken", message: "name pr-watch-6 is taken" },
    });
    terminals.kill.mockResolvedValue({
      error: { kind: "unavailable", message: "kill refused" },
    });
    const stderr = vi.fn();

    await expect(
      startPrWatchers(asTerminals(terminals), "t1", PLACE, [5, 6], stderr),
    ).rejects.toThrow("could not watch PR #6 on hc: name pr-watch-6 is taken");
    expect(terminals.kill).toHaveBeenCalledExactlyOnceWith("t7");
    expect(stderr).toHaveBeenCalledExactlyOnceWith(
      "could not stop the watch t7: kill refused\n",
    );
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
