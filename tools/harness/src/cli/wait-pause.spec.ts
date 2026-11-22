import { describe, expect, it, vi } from "vitest";
import type { Terminal, Terminals } from "../terminal/index.js";
import { CHECKS_POLL_MS } from "./pr-checks.js";
import { childrenPause, pollPause } from "./wait-pause.js";

const T0 = Date.parse("2026-01-02T03:04:05.000Z");

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
  return { self: vi.fn(() => "t1"), wait: vi.fn(), kill: vi.fn() };
}
type TerminalsMock = ReturnType<typeof terminalsMock>;

const asTerminals = (terminals: TerminalsMock) =>
  terminals as unknown as Terminals;

/** A listed child of the caller that finished, by its id and name. */
function finished(id: string, name: string): Terminal {
  return { id, name, state: "finished", labels: {}, cwd: "/repo" };
}

/** The children pause on a fresh clock, for a terminal whose wait the test sets. */
const pauseOf = (terminals: TerminalsMock, clock = clockAt().clock) =>
  childrenPause({ terminals: asTerminals(terminals), self: "t1", clock });

describe("childrenPause: a wait on the caller's children returns on news, and never sleeps", () => {
  it("returns at once for a child that finished and was not reported before", async () => {
    const { clock, sleep } = clockAt();
    const terminals = terminalsMock();
    terminals.wait.mockResolvedValueOnce({
      finished: [finished("t7", "pr-watch-5")],
    });

    expect(await pauseOf(terminals, clock)(900_000)).toBe(false);
    expect(terminals.wait).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("waits again, without returning, when a wake names only children already reported, and does not sleep", async () => {
    const { clock, sleep } = clockAt();
    const terminals = terminalsMock();
    terminals.wait
      .mockResolvedValueOnce({ finished: [finished("t7", "pr-watch-5")] })
      .mockResolvedValueOnce({ finished: [finished("t7", "pr-watch-5")] })
      .mockResolvedValueOnce({ finished: [finished("t8", "pr-watch-6")] });
    const pause = pauseOf(terminals, clock);

    expect(await pause(900_000)).toBe(false);
    expect(await pause(900_000)).toBe(false);
    expect(terminals.wait).toHaveBeenCalledTimes(3);
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe("childrenPause: the bound is the most it waits, and failures are not read as news", () => {
  it("passes the bound when the only wakes are of children already reported and the rest of the bound has passed", async () => {
    const { clock, advance } = clockAt();
    const terminals = terminalsMock();
    terminals.wait
      .mockResolvedValueOnce({ finished: [finished("t7", "pr-watch-5")] })
      .mockImplementationOnce(async () => {
        advance(1_000);
        return { finished: [finished("t7", "pr-watch-5")] };
      });
    const pause = pauseOf(terminals, clock);

    expect(await pause(900_000)).toBe(false);
    expect(await pause(1_000)).toBe(true);
    expect(terminals.wait).toHaveBeenCalledTimes(2);
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

describe("childrenPause: each wait is capped at one checks interval, so a child that finished in the gap is read", () => {
  it("caps each children wait at one checks interval, and re-reads when it times out before the bound", async () => {
    const terminals = terminalsMock();
    terminals.wait.mockResolvedValue({
      error: { kind: "timeout", message: "nothing has finished" },
    });

    expect(await pauseOf(terminals)(900_000)).toBe(false);
    expect(terminals.wait).toHaveBeenCalledWith(
      { children: "any", of: "t1" },
      CHECKS_POLL_MS,
    );
  });

  it("reads a child that finished in the gap before the next wait within one checks interval, not at the bound", async () => {
    const { clock, advance } = clockAt();
    const terminals = terminalsMock();
    terminals.wait
      .mockImplementationOnce(async () => {
        advance(CHECKS_POLL_MS);
        return { error: { kind: "timeout", message: "nothing has finished" } };
      })
      .mockResolvedValueOnce({ finished: [finished("t7", "pr-watch-5")] });
    const pause = pauseOf(terminals, clock);

    expect(await pause(900_000)).toBe(false);
    expect(terminals.wait).toHaveBeenNthCalledWith(
      1,
      { children: "any", of: "t1" },
      CHECKS_POLL_MS,
    );
    expect(await pause(900_000 - CHECKS_POLL_MS)).toBe(false);
    expect(terminals.wait).toHaveBeenCalledTimes(2);
  });

  it("passes the bound when the capped wait times out at the bound", async () => {
    const { clock, advance } = clockAt();
    const terminals = terminalsMock();
    terminals.wait.mockImplementationOnce(async () => {
      advance(CHECKS_POLL_MS);
      return { error: { kind: "timeout", message: "nothing has finished" } };
    });

    expect(await pauseOf(terminals, clock)(CHECKS_POLL_MS)).toBe(true);
  });
});

describe("childrenPause: a message wake is not final, so the wait re-reads and carries on within the bound", () => {
  const woke = {
    error: {
      kind: "woke",
      message: "a message woke the wait before a finish",
    },
  };

  it("returns to re-read the checks, without throwing, when a message wakes the wait before the bound", async () => {
    const terminals = terminalsMock();
    terminals.wait.mockResolvedValueOnce(woke);

    expect(await pauseOf(terminals)(900_000)).toBe(false);
    expect(terminals.wait).toHaveBeenCalledExactlyOnceWith(
      { children: "any", of: "t1" },
      CHECKS_POLL_MS,
    );
  });

  it("carries on waiting within the bound after a message wake, and passes the bound when the rest of it has passed", async () => {
    const { clock, advance } = clockAt();
    const terminals = terminalsMock();
    terminals.wait
      .mockImplementationOnce(async () => {
        advance(CHECKS_POLL_MS);
        return woke;
      })
      .mockImplementationOnce(async () => {
        advance(1_000);
        return woke;
      });
    const pause = pauseOf(terminals, clock);

    expect(await pause(CHECKS_POLL_MS + 1_000)).toBe(false);
    expect(await pause(1_000)).toBe(true);
    expect(terminals.wait).toHaveBeenCalledTimes(2);
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
