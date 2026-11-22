import { describe, expect, it } from "vitest";
import { parseEventLine } from "./hc-events.js";
import { HC_EVENTS_0_1_21 } from "./hc-0.1.21.fixtures.js";

const SNAPSHOT_ONE = HC_EVENTS_0_1_21.snapshot;
const FOREGROUND = HC_EVENTS_0_1_21.foreground;
const FINISHED = HC_EVENTS_0_1_21.finished;
const SNAPSHOT_EMPTY = '{"channel":null,"seq":0,"terminals":[]}';

describe("parseEventLine: the snapshot hc opens the stream with", () => {
  it("reads each terminal in it as changed, so a change between the listing and the follow is not lost", () => {
    expect(parseEventLine(SNAPSHOT_ONE)).toEqual([
      { kind: "changed", terminal: "t2" },
    ]);
  });

  it("reads an empty snapshot as no events", () => {
    expect(parseEventLine(SNAPSHOT_EMPTY)).toEqual([]);
  });

  it("refuses a snapshot whose terminal names no address", () => {
    expect(parseEventLine('{"channel":null,"seq":0,"terminals":[{}]}')).toBe(
      undefined,
    );
  });
});

describe("parseEventLine: a notification", () => {
  it("reads a change to a terminal as changed, whatever its type", () => {
    expect(parseEventLine(FOREGROUND)).toEqual([
      { kind: "changed", terminal: "t2" },
    ]);
  });

  it("reads a finish as finished, so the watch records the final status last", () => {
    expect(parseEventLine(FINISHED)).toEqual([
      { kind: "finished", terminal: "t2" },
    ]);
  });

  it("refuses a notification that names no terminal", () => {
    expect(
      parseEventLine(
        '{"jsonrpc":"2.0","method":"event","params":{"type":"foreground"}}',
      ),
    ).toBe(undefined);
  });
});

describe("parseEventLine: a line that is no hc event", () => {
  it("refuses a line that is not JSON, rather than guessing at it", () => {
    expect(parseEventLine("not json")).toBe(undefined);
  });

  it("refuses a line that is JSON but neither a snapshot nor a notification", () => {
    expect(parseEventLine('{"hello":"world"}')).toBe(undefined);
  });
});
