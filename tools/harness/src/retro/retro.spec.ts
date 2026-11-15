// The Retro unit: reads recorded data, appends through the ledger, moves the marker.
// Everything it depends on is mocked; the decision and marker rewrite are their own units.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { lastRetrospective, markerInstant } from "../hook/index.js";
import type { Ledger, LedgerEvent } from "../ledger/index.js";
import type { Clock, FileSystem } from "../runtime/index.js";
import { decideRetro } from "./due.js";
import { withMarker } from "./marker.js";
import { PLAN_WITH_MARKER, Retro, RetroError } from "./retro.js";

vi.mock("../hook/index.js");
vi.mock("./due.js");
vi.mock("./marker.js");

const NOW = new Date("2026-01-02T03:04:05.678Z");
const STAMP = "2026-01-02T03:04:05Z";
const MARKER = "2026-01-01T00:00:00Z";

const event = (over: Partial<LedgerEvent>): LedgerEvent => ({
  schema: 1,
  id: "e",
  source: "github",
  kind: "outcome",
  occurredAt: "2026-01-01T00:00:10.000Z",
  recordedAt: "2026-01-01T00:00:10.000Z",
  ...over,
});

const trigger = (label: string, occurredAt: string) =>
  event({ kind: "retro-triggered", label, occurredAt });

function setup(
  events: { outcome?: LedgerEvent[]; trigger?: LedgerEvent[] } = {},
) {
  const list = vi.fn(({ kind }: { kind: string }) =>
    Promise.resolve({
      events: (kind === "outcome" ? events.outcome : events.trigger) ?? [],
      skipped: 0,
    }),
  );
  const record = vi.fn().mockResolvedValue({ ok: true, event: {} });
  const writeFile = vi.fn().mockResolvedValue(undefined);
  const readFile = vi.fn().mockResolvedValue("plan text\n");
  const retro = new Retro({
    // The casts stand in for the parts of the ledger and file system a retro never calls.
    ledger: { list, record } as unknown as Ledger,
    fs: { writeFile, readFile } as unknown as FileSystem,
    clock: { now: () => NOW } as Clock,
    root: "/repo",
    readPlans: () => Promise.resolve({ "3.md": "x" }),
  });
  return { retro, list, record, writeFile, readFile };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(lastRetrospective).mockReturnValue(MARKER);
  vi.mocked(markerInstant).mockReturnValue(Date.parse(MARKER));
  vi.mocked(decideRetro).mockReturnValue({
    due: false,
    closedIdeas: 0,
    threshold: 5,
  });
  vi.mocked(withMarker).mockReturnValue("moved\n");
});

describe("Retro.due", () => {
  it("hands the decision the window, closed ideas, metrics and recorded triggers, and writes nothing", async () => {
    const { retro, record, writeFile } = setup({
      outcome: [event({ idea: "0007" })],
      trigger: [trigger("count", "2026-01-01T00:00:30.000Z")],
    });
    const metrics = [{ name: "tokensPerIdea", idea: "0007", worsened: true }];
    const result = await retro.due(metrics);
    expect(decideRetro).toHaveBeenCalledWith({
      windowStart: Date.parse(MARKER),
      closed: [{ idea: "0007", at: Date.parse("2026-01-01T00:00:10.000Z") }],
      metrics,
      triggers: [
        { at: Date.parse("2026-01-01T00:00:30.000Z"), reason: "count" },
      ],
    });
    expect(result).toEqual({
      due: false,
      closedIdeas: 0,
      threshold: 5,
      lastRetrospective: MARKER,
    });
    expect(record).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("opens the window at zero when no retro was ever recorded", async () => {
    vi.mocked(lastRetrospective).mockReturnValue(null);
    const { retro } = setup();
    expect(await retro.due([])).toMatchObject({ lastRetrospective: null });
    expect(vi.mocked(decideRetro).mock.calls[0]?.[0].windowStart).toBe(0);
  });

  it("ignores outcomes that name no idea", async () => {
    const { retro } = setup({ outcome: [event({})] });
    await retro.due([]);
    expect(vi.mocked(decideRetro).mock.calls[0]?.[0].closed).toEqual([]);
  });
});

describe("Retro.record", () => {
  it.each(["", "later", "metric:", "metric:a b", "count extra", "Count"])(
    "refuses the malformed reason %j and writes nothing",
    async (reason) => {
      const { retro, record, writeFile } = setup();
      await expect(retro.record(reason)).rejects.toBeInstanceOf(RetroError);
      expect(record).not.toHaveBeenCalled();
      expect(writeFile).not.toHaveBeenCalled();
    },
  );

  it.each(["count", "manual", "metric:tokensPerIdea"])(
    "appends a retro-triggered event for %s, then moves the marker to the same second",
    async (reason) => {
      const { retro, record, writeFile, readFile } = setup();
      const result = await retro.record(reason);
      expect(record).toHaveBeenCalledWith({
        source: "claude",
        kind: "retro-triggered",
        occurredAt: "2026-01-02T03:04:05.000Z",
        label: reason,
      });
      expect(readFile).toHaveBeenCalledWith(`/repo/${PLAN_WITH_MARKER}`);
      expect(withMarker).toHaveBeenCalledWith("plan text\n", STAMP);
      expect(writeFile).toHaveBeenCalledWith(
        `/repo/${PLAN_WITH_MARKER}`,
        "moved\n",
      );
      expect(result).toEqual({ reason, recordedAt: STAMP, appended: true });
    },
  );

  it("appends no second event for a reason already recorded in the window, but still moves the marker", async () => {
    const { retro, record, writeFile } = setup({
      trigger: [trigger("count", "2026-01-01T00:00:30.000Z")],
    });
    const result = await retro.record("count");
    expect(record).not.toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalledOnce();
    expect(result.appended).toBe(false);
  });

  it("appends again for a reason recorded in an earlier window", async () => {
    const { retro, record } = setup({
      trigger: [trigger("count", MARKER.replace("Z", ".000Z"))],
    });
    expect((await retro.record("count")).appended).toBe(true);
    expect(record).toHaveBeenCalledOnce();
  });

  it("moves no marker when the ledger rejects the event", async () => {
    const { retro, record, writeFile } = setup();
    record.mockResolvedValue({ ok: false, field: "label", message: "bad" });
    await expect(retro.record("count")).rejects.toThrow(/bad/);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("appends nothing when the plan that keeps the marker is missing", async () => {
    const { retro, record, readFile } = setup();
    readFile.mockRejectedValue(
      Object.assign(new Error("gone"), { code: "ENOENT" }),
    );
    await expect(retro.record("count")).rejects.toBeInstanceOf(RetroError);
    expect(record).not.toHaveBeenCalled();
  });
});
