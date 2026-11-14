import { describe, expect, it, vi } from "vitest";
import { parseEvent, type EventInput } from "./schema.js";
import {
  PATH,
  NOW,
  fakeClock,
  fakeFileSystem,
  fakeIds,
  withCode,
} from "./ledger-support.js";
import { Ledger, type ListFilter } from "./ledger.js";

vi.mock("./schema.js");

const start: EventInput = {
  source: "claude",
  kind: "session.start",
  occurredAt: "2026-01-02T03:00:00.000Z",
  session: "s1",
};

/** A ledger over fakes: `parseEvent` is mocked, so it accepts whatever the spec says. */
function setup() {
  const fs = fakeFileSystem();
  const clock = fakeClock();
  const ids = fakeIds();
  const ledger = new Ledger(fs, clock, ids, PATH);
  return { fs, clock, ids, ledger };
}

describe("Ledger.record", () => {
  it("appends one line: the event with schema, the clock's time and a fresh id", async () => {
    const { fs, ledger } = setup();
    vi.mocked(parseEvent).mockReturnValue({ ok: true, event: start });
    const result = await ledger.record(start);
    expect(result).toEqual({
      ok: true,
      event: { ...start, schema: 1, id: "id-1", recordedAt: NOW },
    });
    expect(fs.appendFile.mock.calls).toEqual([
      [
        PATH,
        `${JSON.stringify({ ...start, schema: 1, id: "id-1", recordedAt: NOW })}\n`,
      ],
    ]);
  });

  it("validates the input as an input event, before anything is appended", async () => {
    const { fs, ledger } = setup();
    vi.mocked(parseEvent).mockReturnValue({ ok: true, event: start });
    await ledger.record(start);
    expect(vi.mocked(parseEvent).mock.calls).toEqual([[start, "input"]]);
    expect(fs.appendFile).toHaveBeenCalledTimes(1);
  });

  it("keeps a caller-supplied id and asks the id source for none", async () => {
    const { fs, ids, ledger } = setup();
    const given = { ...start, id: "mine" };
    vi.mocked(parseEvent).mockReturnValue({ ok: true, event: given });
    const result = await ledger.record(given);
    expect(ids.next).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, event: { id: "mine" } });
    expect(fs.appendFile.mock.calls[0]?.[1]).toContain('"id":"mine"');
  });

  it("returns the validation failure, naming the field, and appends nothing", async () => {
    const { fs, ledger } = setup();
    const failure = {
      ok: false as const,
      field: "kind",
      message: "kind must be a known kind",
    };
    vi.mocked(parseEvent).mockReturnValue(failure);
    expect(await ledger.record({ ...start, kind: "nope" })).toEqual(failure);
    expect(fs.appendFile).not.toHaveBeenCalled();
  });

  it("writes each event with its own append, never rewriting earlier lines", async () => {
    const { fs, ledger } = setup();
    vi.mocked(parseEvent).mockReturnValue({ ok: true, event: start });
    await ledger.record(start);
    await ledger.record({ ...start, kind: "session.stop" });
    expect(fs.appendFile).toHaveBeenCalledTimes(2);
    expect(fs.writeFile).not.toHaveBeenCalled();
  });
});

const stored = (id: string, extra: Record<string, unknown> = {}) => ({
  source: "claude",
  kind: "session.start",
  occurredAt: start.occurredAt,
  id,
  ...extra,
});

/** A file of the given lines, read through the fake file system. */
function fileOf(fs: ReturnType<typeof fakeFileSystem>, text: string) {
  fs.readFile.mockResolvedValue(text);
}

describe("Ledger.list", () => {
  it("returns every stored event in file order, with no skipped lines", async () => {
    const { fs, ledger } = setup();
    fileOf(fs, '{"id":"e1"}\n{"id":"e2"}\n');
    vi.mocked(parseEvent).mockImplementation((value) => ({
      ok: true,
      event: value as never,
    }));
    expect(await ledger.list({})).toEqual({
      events: [{ id: "e1" }, { id: "e2" }],
      skipped: 0,
    });
    expect(fs.readFile.mock.calls).toEqual([[PATH]]);
  });

  it("validates each stored line as a stored event", async () => {
    const { fs, ledger } = setup();
    fileOf(fs, '{"id":"e1"}\n');
    vi.mocked(parseEvent).mockReturnValue({ ok: true, event: start as never });
    await ledger.list({});
    expect(vi.mocked(parseEvent).mock.calls).toEqual([
      [{ id: "e1" }, "stored"],
    ]);
  });

  it("returns nothing, without error, when the ledger does not exist", async () => {
    const { fs, ledger } = setup();
    fs.readFile.mockRejectedValue(withCode("ENOENT"));
    expect(await ledger.list({})).toEqual({ events: [], skipped: 0 });
  });

  it("rethrows a read error other than a missing file", async () => {
    const { fs, ledger } = setup();
    fs.readFile.mockRejectedValue(withCode("EACCES", "EACCES"));
    await expect(ledger.list({})).rejects.toThrow("EACCES");
  });

  it("counts a line that is not JSON, or not a stored event, as skipped", async () => {
    const { fs, ledger } = setup();
    fileOf(fs, 'not json\n{"id":"bad"}\n{"id":"e1"}\n');
    vi.mocked(parseEvent).mockImplementation((value) =>
      (value as { id: string }).id === "e1"
        ? { ok: true, event: value as never }
        : { ok: false, field: "id", message: "bad" },
    );
    expect(await ledger.list({})).toEqual({
      events: [{ id: "e1" }],
      skipped: 2,
    });
  });

  it("does not count blank lines as skipped", async () => {
    const { fs, ledger } = setup();
    fileOf(fs, '\n{"id":"e1"}\n\n');
    vi.mocked(parseEvent).mockReturnValue({
      ok: true,
      event: { id: "e1" } as never,
    });
    expect(await ledger.list({})).toEqual({
      events: [{ id: "e1" }],
      skipped: 0,
    });
  });
});

describe("Ledger.list filters", () => {
  const events = [
    stored("e1", { session: "s1" }),
    stored("e2", {
      source: "herdr",
      kind: "pane.spawned",
      occurredAt: "2026-01-02T04:00:00.000Z",
      pane: "w3:p1",
      idea: "0042-loop",
    }),
    stored("e3", {
      source: "github",
      kind: "pr.opened",
      occurredAt: "2026-01-02T05:00:00.000Z",
      idea: "0042-loop",
    }),
  ];

  async function listed(filter: ListFilter) {
    const { fs, ledger } = setup();
    fileOf(fs, events.map((e) => JSON.stringify(e)).join("\n"));
    vi.mocked(parseEvent).mockImplementation((value) => ({
      ok: true,
      event: value as never,
    }));
    return (await ledger.list(filter)).events.map((e) => e.id);
  }

  it.each<[ListFilter, string[]]>([
    [{ session: "s1" }, ["e1"]],
    [{ pane: "w3:p1" }, ["e2"]],
    [{ idea: "0042-loop" }, ["e2", "e3"]],
    [{ source: "github" }, ["e3"]],
    [{ kind: "pr.opened" }, ["e3"]],
    [{ session: "nobody" }, []],
  ])("keeps only the events matching %j", async (filter, expected) => {
    expect(await listed(filter)).toEqual(expected);
  });

  it.each<[ListFilter, string[]]>([
    [{ since: "2026-01-02T04:00:00.000Z" }, ["e2", "e3"]],
    [{ until: "2026-01-02T05:00:00.000Z" }, ["e1", "e2"]],
    [
      {
        since: "2026-01-02T04:00:00.000Z",
        until: "2026-01-02T05:00:00.000Z",
      },
      ["e2"],
    ],
  ])(
    "bounds by occurredAt, since inclusive and until exclusive: %j",
    async (filter, expected) => {
      expect(await listed(filter)).toEqual(expected);
    },
  );
});
