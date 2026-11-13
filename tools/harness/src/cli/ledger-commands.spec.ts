import { describe, expect, it } from "vitest";
import { run } from "./cli.js";

import { DEFAULT, harness } from "./ledger-commands-support.js";

const startFlags = [
  "ledger",
  "record",
  "--source",
  "claude",
  "--kind",
  "session.start",
  "--occurred-at",
  "2026-01-02T03:00:00Z",
  "--session",
  "s1",
];

describe("ledger record", () => {
  it("appends an event built from flags to the default ledger under .kore/state", async () => {
    const h = harness();
    expect(await run(startFlags, h.deps)).toBe(0);
    expect(JSON.parse(h.fs.files.get(DEFAULT) ?? "")).toEqual({
      schema: 1,
      id: "id-1",
      source: "claude",
      kind: "session.start",
      occurredAt: "2026-01-02T03:00:00Z",
      recordedAt: "2026-01-02T03:04:05.000Z",
      session: "s1",
    });
    expect(h.out()).toBe("recorded id-1 session.start\n");
  });

  it("accepts --name=value and converts --number", async () => {
    const h = harness();
    const argv = [
      "ledger",
      "record",
      "--source=claude",
      "--kind=challenge.round",
      "--occurred-at=2026-01-02T03:00:00Z",
      "--label=round-1",
      "--number=12",
    ];
    expect(await run(argv, h.deps)).toBe(0);
    expect(JSON.parse(h.fs.files.get(DEFAULT) ?? "")).toMatchObject({
      number: 12,
    });
  });

  it("appends one JSON event from stdin and prints it under --json", async () => {
    const h = harness(
      JSON.stringify({
        source: "herdr",
        kind: "pane.closed",
        occurredAt: "2026-01-02T03:00:00Z",
        pane: "w3:p1",
      }),
    );
    expect(await run(["ledger", "record", "--json"], h.deps)).toBe(0);
    const printed = JSON.parse(h.out()) as { event: { id: string } };
    expect(printed.event.id).toBe("id-1");
    expect((h.fs.files.get(DEFAULT) ?? "").trimEnd().split("\n")).toHaveLength(
      1,
    );
  });

  it("writes to the path given by --ledger, relative to the working directory", async () => {
    const h = harness();
    await run([...startFlags, "--ledger", "out/x.jsonl"], h.deps);
    expect(h.fs.files.has("/repo/out/x.jsonl")).toBe(true);
    expect(h.fs.files.has(DEFAULT)).toBe(false);
  });
});

describe("ledger record rejections", () => {
  it("rejects a value flag placed before the command instead of misreading it", async () => {
    const h = harness();
    expect(await run(["ledger", "--source", "claude", "record"], h.deps)).toBe(
      2,
    );
    expect(h.err()).toContain('Put "--source" after the command');
  });

  it("rejects an invalid event with exit 1, names the field and appends nothing", async () => {
    const h = harness();
    const argv = startFlags.map((a) => (a === "session.start" ? "bogus" : a));
    expect(await run(argv, h.deps)).toBe(1);
    expect(h.err()).toContain('field "kind"');
    expect(h.out()).toBe("");
    expect(h.fs.files.has(DEFAULT)).toBe(false);
  });

  it("reports the rejected field as JSON under --json", async () => {
    const h = harness();
    const argv = [...startFlags.slice(0, -2), "--number", "x", "--json"];
    expect(await run(argv, h.deps)).toBe(1);
    expect(JSON.parse(h.err())).toMatchObject({ field: "number" });
  });

  it("rejects stdin that is not JSON, and empty stdin as a usage error", async () => {
    const bad = harness("{nope");
    expect(await run(["ledger", "record"], bad.deps)).toBe(1);
    expect(bad.err()).toContain("not valid JSON");
    expect(bad.fs.files.has(DEFAULT)).toBe(false);

    const empty = harness("  \n");
    expect(await run(["ledger", "record"], empty.deps)).toBe(2);
    expect(empty.err()).toContain("No event given");
  });

  it("refuses a prompt field smuggled in on stdin", async () => {
    const h = harness(
      JSON.stringify({
        source: "claude",
        kind: "session.start",
        occurredAt: "2026-01-02T03:00:00Z",
        prompt: "hi",
      }),
    );
    expect(await run(["ledger", "record"], h.deps)).toBe(1);
    expect(h.err()).toContain('"prompt"');
    expect(h.fs.files.has(DEFAULT)).toBe(false);
  });

  it("rejects an unknown flag and a flag missing its value", async () => {
    const unknown = harness();
    expect(await run([...startFlags, "--prompt", "x"], unknown.deps)).toBe(2);
    expect(unknown.err()).toContain('Unknown flag "--prompt"');

    const missing = harness();
    expect(await run(["ledger", "record", "--source"], missing.deps)).toBe(2);
    expect(missing.err()).toContain('Flag "--source" needs a value');
    expect(missing.fs.files.size).toBe(0);
  });
});

async function seeded() {
  const h = harness();
  const events = [
    ["claude", "session.start", "2026-01-02T03:00:00Z", "--session", "s1"],
    ["herdr", "pane.spawned", "2026-01-02T04:00:00Z", "--pane", "w3:p1"],
  ];
  for (const [source, kind, at, flag, value] of events) {
    await run(
      [
        "ledger",
        "record",
        "--source",
        source ?? "",
        "--kind",
        kind ?? "",
        "--occurred-at",
        at ?? "",
        flag ?? "",
        value ?? "",
      ],
      h.deps,
    );
  }
  return h;
}

describe("ledger list", () => {
  it("prints one line per event, oldest first", async () => {
    const h = await seeded();
    h.out();
    const list = harness();
    list.fs.files.set(DEFAULT, h.fs.files.get(DEFAULT) ?? "");
    expect(await run(["ledger", "list"], list.deps)).toBe(0);
    expect(list.out().trimEnd().split("\n")).toEqual([
      "2026-01-02T03:00:00Z claude session.start s1",
      "2026-01-02T04:00:00Z herdr pane.spawned w3:p1",
    ]);
  });

  it("emits events and the skipped count as JSON, applying filters", async () => {
    const h = await seeded();
    h.fs.files.set(DEFAULT, `${h.fs.files.get(DEFAULT) ?? ""}garbage\n`);
    h.out();
    const list = harness();
    list.fs.files.set(DEFAULT, h.fs.files.get(DEFAULT) ?? "");
    const argv = [
      "ledger",
      "list",
      "--json",
      "--source",
      "herdr",
      "--since",
      "2026-01-02T03:30:00Z",
    ];
    expect(await run(argv, list.deps)).toBe(0);
    const result = JSON.parse(list.out()) as {
      events: { pane: string }[];
      skipped: number;
    };
    expect(result.events.map((e) => e.pane)).toEqual(["w3:p1"]);
    expect(result.skipped).toBe(1);
  });

  it("reports skipped lines in human output", async () => {
    const h = harness();
    h.fs.files.set(DEFAULT, "garbage\n");
    expect(await run(["ledger", "list"], h.deps)).toBe(0);
    expect(h.out()).toBe("skipped 1 malformed ledger line(s)\n");
  });
});

describe("ledger list filters", () => {
  it.each([
    [["--source", "slack"], "Invalid --source"],
    [["--kind", "nope"], "Invalid --kind"],
    [["--since", "yesterday"], "Invalid --since"],
    [["--until", "2026-13-01T00:00:00Z"], "Invalid --until"],
  ])(
    "rejects a bad filter %j without reading the ledger",
    async (flags, message) => {
      const h = harness();
      const reads: string[] = [];
      const read = h.fs.readFile.bind(h.fs);
      h.fs.readFile = (path) => {
        reads.push(path);
        return read(path);
      };
      expect(await run(["ledger", "list", ...flags], h.deps)).toBe(2);
      expect(h.err()).toContain(message);
      expect(reads).toEqual([]);
      expect(h.runner.calls).toEqual([]);
    },
  );

  it("filters by session, pane, idea and kind through the flags", async () => {
    const h = harness();
    h.fs.files.set(
      DEFAULT,
      `${JSON.stringify({ schema: 1, id: "a", source: "claude", kind: "session.start", occurredAt: "2026-01-02T03:00:00Z", recordedAt: "2026-01-02T03:00:01Z", session: "s1", pane: "p", idea: "i" })}\n`,
    );
    for (const flags of [
      ["--session", "s1"],
      ["--pane", "p"],
      ["--idea", "i"],
      ["--kind", "session.start"],
      ["--until", "2026-01-02T04:00:00Z"],
    ]) {
      const f = harness();
      f.fs.files.set(DEFAULT, h.fs.files.get(DEFAULT) ?? "");
      await run(["ledger", "list", "--json", ...flags], f.deps);
      expect(
        (JSON.parse(f.out()) as { events: unknown[] }).events,
      ).toHaveLength(1);
    }
    const miss = harness();
    miss.fs.files.set(DEFAULT, h.fs.files.get(DEFAULT) ?? "");
    await run(["ledger", "list", "--json", "--session", "other"], miss.deps);
    expect(
      (JSON.parse(miss.out()) as { events: unknown[] }).events,
    ).toHaveLength(0);
  });
});
