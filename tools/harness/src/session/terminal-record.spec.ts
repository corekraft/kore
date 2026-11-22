import { describe, expect, it, vi } from "vitest";
import { recordOfTerminal } from "./terminal-record.js";
import type { SessionRecord, SessionRegistry } from "./registry.js";

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

/** A registry whose listing is the given records: the unit reads only its all(). */
const registryListing = (records: SessionRecord[]) => {
  const all = vi.fn<SessionRegistry["all"]>(() => Promise.resolve(records));
  return { registry: { all }, all };
};

describe("recordOfTerminal", () => {
  it("finds the record whose hc terminal is the given id", async () => {
    const { registry, all } = registryListing([
      { ...RECORD, terminal: "t9", name: "other" },
      RECORD,
    ]);

    expect(await recordOfTerminal(registry, "t7")).toEqual(RECORD);
    expect(all).toHaveBeenCalledTimes(1);
  });

  it("returns undefined when no record names the terminal", async () => {
    expect(
      await recordOfTerminal(registryListing([RECORD]).registry, "t1"),
    ).toBeUndefined();
  });

  it("prefers the open record when a closed one names the same terminal", async () => {
    const { registry } = registryListing([
      CLOSED,
      { ...RECORD, name: "new-writer" },
    ]);

    expect((await recordOfTerminal(registry, "t7"))?.name).toBe("new-writer");
  });

  it("returns the closed record when it is the only one that names the terminal", async () => {
    expect(
      await recordOfTerminal(registryListing([CLOSED]).registry, "t7"),
    ).toEqual(CLOSED);
  });
});
