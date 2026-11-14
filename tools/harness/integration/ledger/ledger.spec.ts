import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "../../src/testing/index.js";
import { Ledger, type ListFilter } from "../../src/ledger/index.js";

const PATH = "/repo/.kore/state/ledger.jsonl";
const RECORDED = "2026-01-02T03:04:05.000Z";

function setup() {
  const fs = new MemoryFileSystem();
  let n = 0;
  const ledger = new Ledger(
    fs,
    { now: () => new Date(RECORDED), sleep: () => Promise.resolve() },
    { next: () => `id-${++n}` },
    PATH,
  );
  return { fs, ledger };
}

const start = {
  source: "claude",
  kind: "session.start",
  occurredAt: "2026-01-02T03:00:00.000Z",
  session: "s1",
};

describe("Ledger.record", () => {
  it("appends exactly one line stamped with the injected clock and a fresh id", async () => {
    const { fs, ledger } = setup();
    const result = await ledger.record(start);
    expect(result.ok).toBe(true);
    const text = fs.files.get(PATH) ?? "";
    expect(text.endsWith("\n")).toBe(true);
    expect(text.trimEnd().split("\n")).toHaveLength(1);
    expect(JSON.parse(text)).toEqual({
      ...start,
      schema: 1,
      id: "id-1",
      recordedAt: RECORDED,
    });
  });

  it("keeps a caller-supplied id", async () => {
    const { fs, ledger } = setup();
    await ledger.record({ ...start, id: "mine" });
    expect(JSON.parse(fs.files.get(PATH) ?? "")).toMatchObject({ id: "mine" });
  });

  it("appends after earlier lines without rewriting them", async () => {
    const { fs, ledger } = setup();
    await ledger.record(start);
    const first = fs.files.get(PATH) ?? "";
    await ledger.record({ ...start, kind: "session.stop" });
    expect((fs.files.get(PATH) ?? "").startsWith(first)).toBe(true);
    expect((fs.files.get(PATH) ?? "").trimEnd().split("\n")).toHaveLength(2);
  });

  it("rejects an invalid event, names the field, and appends nothing", async () => {
    const { fs, ledger } = setup();
    const result = await ledger.record({ ...start, kind: "nope" });
    expect(result).toMatchObject({ ok: false, field: "kind" });
    expect(fs.files.has(PATH)).toBe(false);
  });

  it("never stores prompt text, tool input or file contents", async () => {
    const { fs, ledger } = setup();
    for (const field of ["prompt", "toolInput", "toolOutput", "content"]) {
      const result = await ledger.record({ ...start, [field]: "secret" });
      expect(result).toMatchObject({ ok: false, field });
    }
    expect(fs.files.has(PATH)).toBe(false);
  });
});

async function seeded() {
  const { fs, ledger } = setup();
  const events = [
    { ...start, id: "e1" },
    {
      source: "herdr",
      kind: "pane.spawned",
      occurredAt: "2026-01-02T04:00:00.000Z",
      pane: "w3:p1",
      idea: "0042-loop",
      id: "e2",
    },
    {
      source: "github",
      kind: "pr.opened",
      occurredAt: "2026-01-02T05:00:00.000Z",
      number: 7,
      idea: "0042-loop",
      id: "e3",
    },
    {
      source: "claude",
      kind: "tool.end",
      occurredAt: "2026-01-02T06:00:00.000Z",
      session: "s2",
      pane: "w3:p1",
      tool: "Bash",
      outcome: "success",
      id: "e4",
    },
  ];
  for (const event of events) {
    await ledger.record(event);
  }
  return { fs, ledger };
}
const ids = (events: { id: string }[]) => events.map((e) => e.id);

describe("Ledger.list", () => {
  it("returns every event in file order and no skipped lines when unfiltered", async () => {
    const { ledger } = await seeded();
    const result = await ledger.list({});
    expect(ids(result.events)).toEqual(["e1", "e2", "e3", "e4"]);
    expect(result.skipped).toBe(0);
  });

  it("returns nothing, without error, when the ledger does not exist", async () => {
    const { ledger } = setup();
    expect(await ledger.list({})).toEqual({ events: [], skipped: 0 });
  });
});

describe("Ledger.list filters", () => {
  it.each<[ListFilter, string[]]>([
    [{ session: "s1" }, ["e1"]],
    [{ session: "s2" }, ["e4"]],
    [{ pane: "w3:p1" }, ["e2", "e4"]],
    [{ idea: "0042-loop" }, ["e2", "e3"]],
    [{ source: "github" }, ["e3"]],
    [{ kind: "tool.end" }, ["e4"]],
    [{ since: "2026-01-02T04:00:00.000Z" }, ["e2", "e3", "e4"]],
    [{ until: "2026-01-02T05:00:00.000Z" }, ["e1", "e2"]],
    [
      {
        since: "2026-01-02T04:00:00.000Z",
        until: "2026-01-02T06:00:00.000Z",
      },
      ["e2", "e3"],
    ],
    [{ pane: "w3:p1", idea: "0042-loop" }, ["e2"]],
    [{ session: "nobody" }, []],
  ])("filters by %j", async (filter, expected) => {
    const { ledger } = await seeded();
    expect(ids((await ledger.list(filter)).events)).toEqual(expected);
  });
});

describe("Ledger.list malformed lines", () => {
  it("skips malformed, partial and invalid lines and counts them", async () => {
    const { fs, ledger } = await seeded();
    fs.files.set(
      PATH,
      `${fs.files.get(PATH) ?? ""}not json\n{"half":\n{"schema":1}\n[1]\n\n{"schema":1,"id":"torn"`,
    );
    const result = await ledger.list({});
    expect(ids(result.events)).toEqual(["e1", "e2", "e3", "e4"]);
    expect(result.skipped).toBe(5);
  });

  it("counts skipped lines even when a filter excludes everything else", async () => {
    const { fs, ledger } = await seeded();
    fs.files.set(PATH, `${fs.files.get(PATH) ?? ""}garbage\n`);
    const result = await ledger.list({ session: "nobody" });
    expect(result).toEqual({ events: [], skipped: 1 });
  });

  it("rethrows read errors other than a missing file", async () => {
    const { fs, ledger } = setup();
    fs.readFile = () => Promise.reject(new Error("EACCES"));
    await expect(ledger.list({})).rejects.toThrow("EACCES");
  });
});
