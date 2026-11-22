import { describe, expect, it, vi } from "vitest";
import { recordsOfTerminal } from "./terminal-record.js";
import type {
  SessionRecord,
  SessionRecords,
  SessionRegistry,
  UnreadableRecord,
} from "./registry.js";

const RECORD: SessionRecord = {
  name: "hc-writer",
  paneId: "",
  backend: "hc",
  terminal: "t7",
  model: "claude-sonnet-5-5",
  role: "writer",
  effort: "high",
  createdAt: "2026-01-02T03:04:05.000Z",
};
const CLOSED = {
  ...RECORD,
  name: "old-writer",
  closedAt: "2026-01-02T03:06:00.000Z",
};
const UNREADABLE: UnreadableRecord = {
  file: "/main/.kore/state/sessions/hc-writer.json",
  reason: "is not a valid session record",
  terminal: "t7",
};

/** A registry whose listing is the given records and files: the unit reads only its all(). */
const registryListing = (
  records: SessionRecord[],
  unreadable: UnreadableRecord[] = [],
) => {
  const listed: SessionRecords = { records, unreadable };
  const all = vi.fn<SessionRegistry["all"]>(() => Promise.resolve(listed));
  return { registry: { all }, all };
};

describe("recordsOfTerminal", () => {
  it("finds the record whose hc terminal is the given id", async () => {
    const { registry, all } = registryListing([
      { ...RECORD, terminal: "t9", name: "other" },
      RECORD,
    ]);

    expect(await recordsOfTerminal(registry, "t7")).toEqual({
      record: RECORD,
      unreadable: [],
    });
    expect(all).toHaveBeenCalledTimes(1);
  });

  it("returns no record when no record names the terminal", async () => {
    expect(
      await recordsOfTerminal(registryListing([RECORD]).registry, "t1"),
    ).toEqual({ record: undefined, unreadable: [] });
  });

  it("prefers the open record when a closed one names the same terminal", async () => {
    const { registry } = registryListing([
      CLOSED,
      { ...RECORD, name: "new-writer" },
    ]);

    expect((await recordsOfTerminal(registry, "t7")).record?.name).toBe(
      "new-writer",
    );
  });

  it("returns the closed record when it is the only one that names the terminal", async () => {
    expect(
      (await recordsOfTerminal(registryListing([CLOSED]).registry, "t7"))
        .record,
    ).toEqual(CLOSED);
  });

  it("reports the unreadable file that names the terminal, and no other", async () => {
    const other: UnreadableRecord = {
      file: "/main/.kore/state/sessions/other.json",
      reason: "x",
      terminal: "t9",
    };
    const { registry } = registryListing([], [UNREADABLE, other]);

    expect(await recordsOfTerminal(registry, "t7")).toEqual({
      record: undefined,
      unreadable: [UNREADABLE],
    });
  });
});
