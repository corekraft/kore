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

/* Scrubbed copies of the lines hc 0.1.21 printed on 2026-11-22: the shapes are hc's, the values are not. */
const CAPTURED_SNAPSHOT =
  '{"channel":null,"seq":8841,"terminals":[{"address":"t1","argv":["/bin/bash"],"cwd":"/home/agent","finished_ms":1795303144095,"labels":{"where":"kore / 1"},"name":null,"parent":null,"reason":"killed","state":"finished","turn":0},{"address":"t4","argv":["/bin/bash"],"cwd":"/home/agent","finished_ms":null,"labels":{},"name":null,"parent":null,"reason":null,"state":"live","status":{"app":"claude-code","state":"working"},"turn":13}]}';
const CAPTURED_STATUS =
  '{"jsonrpc":"2.0","method":"event","params":{"data":{"records":{"xvrc94wsy":{"app":"claude-code","state":"working","title":"started by Claude"}},"reported":true,"status":{"app":"claude-code","state":"working"}},"seq":8849,"terminal":"t4","type":"status"}}';
const CAPTURED_CREATED =
  '{"jsonrpc":"2.0","method":"event","params":{"data":{"address":"t11h","argv":["sleep","1"],"cwd":"/home/agent","die_with_parent":true,"exit_code":null,"finished_ms":null,"labels":{},"name":"evprobe","parent":"t3f","reason":null,"reported":false,"rm":true,"state":"live","status":null,"turn":0},"seq":8842,"terminal":"t11h","type":"created"}}';
const CAPTURED_LABELS =
  '{"jsonrpc":"2.0","method":"event","params":{"data":{"labels":{"where":"tools / 1"}},"seq":8844,"terminal":"t11h","type":"labels"}}';
const CAPTURED_REMOVED =
  '{"jsonrpc":"2.0","method":"event","params":{"data":{},"seq":8846,"terminal":"t11h","type":"removed"}}';
const HC_ERROR_LINE =
  '{"error":{"hint":"ls --all","kind":"not_found","message":"no terminal \\"nope\\""}}';

describe("parseEventLine: the captured hc 0.1.21 shapes", () => {
  it("reads each terminal in a captured snapshot as changed", () => {
    expect(parseEventLine(CAPTURED_SNAPSHOT)).toEqual([
      { kind: "changed", terminal: "t1" },
      { kind: "changed", terminal: "t4" },
    ]);
  });

  it("reads a captured status notification as changed, by its params.terminal", () => {
    expect(parseEventLine(CAPTURED_STATUS)).toEqual([
      { kind: "changed", terminal: "t4" },
    ]);
  });

  it("reads a captured created notification as changed, by its params.terminal", () => {
    expect(parseEventLine(CAPTURED_CREATED)).toEqual([
      { kind: "changed", terminal: "t11h" },
    ]);
  });

  it("reads a captured labels notification as changed", () => {
    expect(parseEventLine(CAPTURED_LABELS)).toEqual([
      { kind: "changed", terminal: "t11h" },
    ]);
  });

  it("reads a captured removed notification as changed, so the watch reads it and skips it when hc says not-found", () => {
    expect(parseEventLine(CAPTURED_REMOVED)).toEqual([
      { kind: "changed", terminal: "t11h" },
    ]);
  });

  it("refuses an hc error line printed on stdout, rather than reading it as an event", () => {
    expect(parseEventLine(HC_ERROR_LINE)).toBe(undefined);
  });
});
