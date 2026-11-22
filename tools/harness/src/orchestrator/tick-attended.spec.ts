import { describe, expect, it, vi } from "vitest";
import type { Terminal, TerminalError, Terminals } from "../terminal/index.js";
import { HarnessCliError } from "./harness-cli.js";
import { AttendedTerminal } from "./tick-attended.js";

type Port = Pick<Terminals, "list" | "send">;

function terminals(over: Partial<Port> = {}): Port {
  return {
    list: vi.fn().mockResolvedValue([]),
    send: vi.fn().mockResolvedValue({ id: "t9" }),
    ...over,
  } as Port;
}

const terminal = (id: string, extra: Partial<Terminal> = {}): Terminal => ({
  id,
  state: "live",
  status: "idle",
  labels: { "kore-attended": "1" },
  cwd: "/main",
  ...extra,
});

describe("AttendedTerminal.attendedPane", () => {
  it("finds the one live agent terminal labelled kore-attended=1", async () => {
    const t = terminals({ list: vi.fn().mockResolvedValue([terminal("t9")]) });

    expect(await new AttendedTerminal(t).attendedPane()).toBe("t9");
    expect(t.list).toHaveBeenCalledWith({ labels: { "kore-attended": "1" } });
  });

  it("finds none, so nothing is typed, when no terminal carries the label", async () => {
    expect(
      await new AttendedTerminal(terminals()).attendedPane(),
    ).toBeUndefined();
  });

  it("ignores a finished terminal that carries the label, since it is no attended terminal", async () => {
    const t = terminals({
      list: vi.fn().mockResolvedValue([terminal("t9", { state: "finished" })]),
    });

    expect(await new AttendedTerminal(t).attendedPane()).toBeUndefined();
  });

  it("ignores a live terminal that has reported no status, since it is not an agent", async () => {
    const t = terminals({
      list: vi.fn().mockResolvedValue([
        {
          id: "t9",
          state: "live",
          labels: { "kore-attended": "1" },
          cwd: "/main",
        },
      ]),
    });

    expect(await new AttendedTerminal(t).attendedPane()).toBeUndefined();
  });

  it("refuses, naming the ids and the labels to fix, when two agent terminals carry the label", async () => {
    const t = terminals({
      list: vi.fn().mockResolvedValue([terminal("t9"), terminal("t10")]),
    });

    await expect(new AttendedTerminal(t).attendedPane()).rejects.toThrow(
      new HarnessCliError(
        "2 live agent terminals are labelled kore-attended=1 (t9, t10), so the notice has no one attended terminal. Label all but one kore-attended=0 with hc label <id> kore-attended=0, so exactly one is kore-attended=1.",
      ),
    );
  });

  it("refuses with hc's message and hint when the listing fails", async () => {
    const failure: TerminalError = {
      error: {
        kind: "unavailable",
        message: "hc is not running",
        hint: "start the core",
      },
    };
    const t = terminals({ list: vi.fn().mockResolvedValue(failure) });

    await expect(new AttendedTerminal(t).attendedPane()).rejects.toThrow(
      new HarnessCliError("hc is not running (start the core)"),
    );
  });
});

describe("AttendedTerminal.send", () => {
  it("types the line into the attended terminal and returns undefined once it is sent", async () => {
    const t = terminals();

    expect(
      await new AttendedTerminal(t).send("t9", "Idea 0034 needs a person."),
    ).toBeUndefined();
    expect(t.send).toHaveBeenCalledWith("t9", "Idea 0034 needs a person.");
  });

  it("returns hc's message and hint when the send fails, so the pass records nothing", async () => {
    const failure: TerminalError = {
      error: {
        kind: "not-live",
        message: "terminal t9 has finished",
        hint: "start a new one",
      },
    };
    const t = terminals({ send: vi.fn().mockResolvedValue(failure) });

    expect(await new AttendedTerminal(t).send("t9", "line")).toBe(
      "terminal t9 has finished (start a new one)",
    );
  });
});
