// Recording a scan's main-session figures as one retro.main-session event (#940), as a
// unit: the flag reader is mocked, and the ledger is a port the test fakes, so only the
// recorder's rules run: the flag, the window, the fields, and a refused event.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { environments, readOverlay } from "../flag/index.js";
import type { Ledger } from "../ledger/index.js";
import type { CliDeps, FileSystem } from "../runtime/index.js";
import { mainLedger } from "./retro-ledger.js";
import { recordMainSession, recordScanFigures } from "./retro-main-record.js";

vi.mock("../flag/index.js");
vi.mock("./retro-ledger.js");

const FIGURES = {
  sessions: 2,
  pollMinutes: 6.5,
  paneReads: 3,
  signedSends: 1,
  rawSends: 4,
};

const NOW = new Date("2026-11-16T10:00:00.000Z");

/** The only fields a retro.main-session event may carry, in sorted order. */
const EVENT_FIELDS = [
  "kind",
  "occurredAt",
  "paneReads",
  "pollMinutes",
  "rawSends",
  "signedSends",
  "source",
  "windowEnd",
  "windowStart",
];

function ports(record = vi.fn().mockResolvedValue({ ok: true, event: {} })) {
  return {
    ledger: { record },
    clock: { now: () => NOW },
    fs: {} as FileSystem,
    root: "/repo",
  };
}

/** The local overlay, with the main-session flag on or off. */
function overlay(flag: boolean | undefined) {
  vi.mocked(environments).mockResolvedValue(["local"]);
  vi.mocked(readOverlay).mockResolvedValue({
    features: flag === undefined ? {} : { "main-session-figures": flag },
  } as Awaited<ReturnType<typeof readOverlay>>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("recordMainSession: one event per scan, when the flag is on", () => {
  it("records one retro.main-session event with the window and the figures", async () => {
    overlay(true);
    const p = ports();
    const recorded = await recordMainSession(p, {
      start: Date.parse("2026-11-02T00:00:00.000Z"),
      end: NOW.getTime(),
      figures: FIGURES,
    });
    expect(recorded).toBe(true);
    expect(p.ledger.record).toHaveBeenCalledTimes(1);
    expect(p.ledger.record).toHaveBeenCalledWith({
      source: "claude",
      kind: "retro.main-session",
      occurredAt: "2026-11-16T10:00:00.000Z",
      windowStart: "2026-11-02T00:00:00.000Z",
      windowEnd: "2026-11-16T10:00:00.000Z",
      pollMinutes: 6.5,
      paneReads: 3,
      signedSends: 1,
      rawSends: 4,
    });
  });

  it("records the window as the epoch when the scan had no start, so the event is still one window", async () => {
    overlay(true);
    const p = ports();
    await recordMainSession(p, {
      start: 0,
      end: NOW.getTime(),
      figures: FIGURES,
    });
    expect(vi.mocked(p.ledger.record).mock.calls[0]?.[0]).toMatchObject({
      windowStart: "1970-01-01T00:00:00.000Z",
    });
  });

  it("records a scan whose counts are all zero, because an empty window is a measured zero", async () => {
    overlay(true);
    const p = ports();
    await recordMainSession(p, {
      start: 0,
      end: NOW.getTime(),
      figures: {
        sessions: 0,
        pollMinutes: 0,
        paneReads: 0,
        signedSends: 0,
        rawSends: 0,
      },
    });
    expect(vi.mocked(p.ledger.record).mock.calls[0]?.[0]).toMatchObject({
      pollMinutes: 0,
      paneReads: 0,
      signedSends: 0,
      rawSends: 0,
    });
  });

  it("carries no field beyond the window and the five figures, so no command text is stored", async () => {
    overlay(true);
    const p = ports();
    await recordMainSession(p, {
      start: 0,
      end: NOW.getTime(),
      figures: FIGURES,
    });
    expect(
      Object.keys(vi.mocked(p.ledger.record).mock.calls[0]?.[0] ?? {}).sort(),
    ).toEqual(EVENT_FIELDS);
  });
});

describe("recordMainSession: nothing is recorded unless the flag is on", () => {
  it("records nothing while the local overlay leaves the flag off", async () => {
    overlay(false);
    const p = ports();
    expect(
      await recordMainSession(p, {
        start: 0,
        end: NOW.getTime(),
        figures: FIGURES,
      }),
    ).toBe(false);
    expect(p.ledger.record).not.toHaveBeenCalled();
  });

  it("records nothing when the overlay does not name the flag at all", async () => {
    overlay(undefined);
    const p = ports();
    await recordMainSession(p, {
      start: 0,
      end: NOW.getTime(),
      figures: FIGURES,
    });
    expect(p.ledger.record).not.toHaveBeenCalled();
  });

  it("records nothing when there is no local overlay", async () => {
    vi.mocked(environments).mockResolvedValue([]);
    const p = ports();
    await recordMainSession(p, {
      start: 0,
      end: NOW.getTime(),
      figures: FIGURES,
    });
    expect(p.ledger.record).not.toHaveBeenCalled();
  });
});

describe("recordScanFigures: the scan's window and its main checkout's ledger", () => {
  const deps = {
    clock: { now: () => NOW },
    fs: {} as FileSystem,
  } as unknown as CliDeps;

  it("records nothing when there is no main checkout to hold the ledger", async () => {
    overlay(true);
    vi.mocked(mainLedger).mockResolvedValue(undefined);
    expect(await recordScanFigures(deps, "/repo", undefined, FIGURES)).toBe(
      false,
    );
  });

  it("records the scan through the main checkout's ledger, from the scan's own since", async () => {
    overlay(true);
    const record = vi.fn().mockResolvedValue({ ok: true, event: {} });
    vi.mocked(mainLedger).mockResolvedValue({ record } as unknown as Ledger);
    expect(
      await recordScanFigures(deps, "/repo", "2026-11-02T00:00:00Z", FIGURES),
    ).toBe(true);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "retro.main-session",
        windowStart: "2026-11-02T00:00:00.000Z",
        windowEnd: "2026-11-16T10:00:00.000Z",
      }),
    );
  });
});

describe("recordMainSession: a refused event fails by name", () => {
  it("throws with the ledger's reason and the fix when the event is refused", async () => {
    overlay(true);
    const p = ports(
      vi.fn().mockResolvedValue({
        ok: false,
        field: "paneReads",
        message:
          'Invalid event: field "paneReads" must be a non-negative whole number.',
      }),
    );
    await expect(
      recordMainSession(p, { start: 0, end: NOW.getTime(), figures: FIGURES }),
    ).rejects.toThrow(
      /retro\.main-session event was rejected: Invalid event: field "paneReads".*Fix the ledger/s,
    );
  });
});
