import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { checkHcVersion } from "./hc-version.js";
import { parseEventLine } from "./hc-events.js";
import { HcTerminals } from "./HcTerminals.js";
import type { LineStream } from "../runtime/index.js";
import { scripted } from "./hc-terminals-support.js";
import type { TerminalEvent } from "./port.js";

// The unit is the adapter's events method: its version check and its line parser are doubles here (ADR 0098).
// The parser has its own spec, which reads hc's recorded lines.
vi.mock("./hc-version.js", () => ({
  checkHcVersion: vi.fn(async () => undefined),
}));
vi.mock("./hc-events.js", () => ({ parseEventLine: vi.fn() }));

/** A LineStream that yields these lines, and records the command it was asked to run. */
function streamOf(...printed: string[]): LineStream & { lines: Mock } {
  return {
    lines: vi.fn((_command: string, _args: readonly string[]) =>
      (async function* () {
        yield* printed;
      })(),
    ),
  };
}

/** The items a stream yields, in order, up to its end or its error. */
async function collect(stream: AsyncIterable<unknown>): Promise<unknown[]> {
  const seen: unknown[] = [];
  for await (const item of stream) {
    seen.push(item);
  }
  return seen;
}

describe("HcTerminals: events follows hc events --json, one event per line it reads", () => {
  it("yields what the parser reads from each line, in line order", async () => {
    const snapshot: TerminalEvent[] = [{ kind: "changed", terminal: "t2" }];
    const finish: TerminalEvent[] = [{ kind: "finished", terminal: "t2" }];
    vi.mocked(parseEventLine).mockImplementation((line) =>
      line === "snapshot" ? snapshot : finish,
    );
    const lines = streamOf("snapshot", "finish");
    expect(
      await collect(
        new HcTerminals({ runner: scripted(), env: {}, lines }).events(),
      ),
    ).toEqual([...snapshot, ...finish]);
    expect(vi.mocked(parseEventLine).mock.calls).toEqual([
      ["snapshot"],
      ["finish"],
    ]);
  });

  it("follows the terminal and label filters as separate hc events flags, after --json", async () => {
    const lines = streamOf();
    await collect(
      new HcTerminals({ runner: scripted(), env: {}, lines }).events({
        terminal: "t2",
        labels: { "kore-session": "s1" },
      }),
    );
    expect(lines.lines.mock.calls).toEqual([
      [
        "hc",
        ["events", "--json", "--terminal", "t2", "--label", "kore-session=s1"],
      ],
    ]);
  });

  it("refuses to stream when hc is not the pinned version, and starts no stream", async () => {
    vi.mocked(checkHcVersion).mockResolvedValueOnce({
      error: {
        kind: "unavailable",
        message: "hc is 0.1.20",
        hint: "install the pin",
      },
    });
    const lines = streamOf();
    await expect(
      collect(new HcTerminals({ runner: scripted(), env: {}, lines }).events()),
    ).rejects.toThrow("hc is 0.1.20 (install the pin)");
    expect(lines.lines).not.toHaveBeenCalled();
  });

  it("throws at a line the parser refuses, naming the pin, rather than yielding a guess", async () => {
    vi.mocked(parseEventLine).mockReturnValueOnce(undefined);
    const lines = streamOf("garbage");
    await expect(
      collect(new HcTerminals({ runner: scripted(), env: {}, lines }).events()),
    ).rejects.toThrow(
      "hc events printed a line that is not an event (check hc --version against the pin in docs/operations/hc-pin.md)",
    );
  });
});
