import { describe, expect, it, vi } from "vitest";
import { isTimestamp } from "../ledger/index.js";
import { parseIdeas, parseWindowFlags } from "./flow-commands-flags.js";

vi.mock("../ledger/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ledger/index.js")>()),
  isTimestamp: vi.fn(),
}));

describe("parseWindowFlags: the window effort", () => {
  it("reads each recognized effort as the window effort", () => {
    for (const effort of ["low", "medium", "high", "xhigh", "max"]) {
      expect(parseWindowFlags({ "window-effort": effort })).toEqual({
        windowEffort: effort,
      });
    }
  });

  it("leaves the window effort out when the flag is absent", () => {
    expect(parseWindowFlags({})).toEqual({});
  });

  it("refuses an unrecognized effort, naming the flag, the value and the allowed values", () => {
    expect(parseWindowFlags({ "window-effort": "hihg" })).toEqual({
      error:
        'Invalid --window-effort "hihg". Use one of low, medium, high, xhigh, max.',
    });
  });

  it("refuses a bare --window-effort with no value", () => {
    expect(parseWindowFlags({ "window-effort": true })).toEqual({
      error:
        'Invalid --window-effort "true". Use one of low, medium, high, xhigh, max.',
    });
  });
});

describe("parseWindowFlags: the time range", () => {
  it("reads --as-of, --since and --until as dates", () => {
    vi.mocked(isTimestamp).mockReturnValue(true);

    expect(
      parseWindowFlags({
        "as-of": "2026-01-05T00:00:00Z",
        since: "2026-01-01T00:00:00Z",
        until: "2026-01-04T00:00:00Z",
      }),
    ).toEqual({
      asOf: new Date("2026-01-05T00:00:00Z"),
      since: new Date("2026-01-01T00:00:00Z"),
      until: new Date("2026-01-04T00:00:00Z"),
    });
  });

  it("refuses a time that is not ISO 8601, and a --since after --until", () => {
    vi.mocked(isTimestamp).mockReturnValue(false);
    expect(parseWindowFlags({ since: "yesterday" })).toEqual({
      error:
        'Invalid --since "yesterday". Use an ISO 8601 UTC time such as 2026-01-02T03:04:05Z.',
    });

    vi.mocked(isTimestamp).mockReturnValue(true);
    expect(
      parseWindowFlags({
        since: "2026-01-04T00:00:00Z",
        until: "2026-01-01T00:00:00Z",
      }),
    ).toEqual({
      error:
        "Invalid --since 2026-01-04T00:00:00.000Z: it is after --until 2026-01-01T00:00:00.000Z. Swap them.",
    });
  });
});

describe("parseWindowFlags: the split date (#1047)", () => {
  it("reads --split-at as a date beside the other bounds", () => {
    vi.mocked(isTimestamp).mockReturnValue(true);

    expect(
      parseWindowFlags({
        since: "2026-11-01T00:00:00Z",
        until: "2026-11-30T00:00:00Z",
        "split-at": "2026-11-16T00:00:00Z",
      }),
    ).toEqual({
      since: new Date("2026-11-01T00:00:00Z"),
      until: new Date("2026-11-30T00:00:00Z"),
      splitAt: new Date("2026-11-16T00:00:00Z"),
    });
  });

  it("leaves the split out when the flag is absent, so nothing else about the range changes", () => {
    vi.mocked(isTimestamp).mockReturnValue(true);

    expect(parseWindowFlags({ since: "2026-11-01T00:00:00Z" })).toEqual({
      since: new Date("2026-11-01T00:00:00Z"),
    });
  });

  it("accepts a split date on either bound, which leaves one side empty", () => {
    vi.mocked(isTimestamp).mockReturnValue(true);

    expect(
      parseWindowFlags({
        since: "2026-11-16T00:00:00Z",
        until: "2026-11-16T00:00:00Z",
        "split-at": "2026-11-16T00:00:00Z",
      }),
    ).toEqual({
      since: new Date("2026-11-16T00:00:00Z"),
      until: new Date("2026-11-16T00:00:00Z"),
      splitAt: new Date("2026-11-16T00:00:00Z"),
    });
  });

  it("refuses a split date that is not an ISO 8601 time, naming the flag", () => {
    vi.mocked(isTimestamp).mockReturnValue(false);

    expect(parseWindowFlags({ "split-at": "last friday" })).toEqual({
      error:
        'Invalid --split-at "last friday". Use an ISO 8601 UTC time such as 2026-01-02T03:04:05Z.',
    });
  });

  it("refuses a split date before --since, because the before side would be silently empty", () => {
    vi.mocked(isTimestamp).mockReturnValue(true);

    expect(
      parseWindowFlags({
        since: "2026-11-10T00:00:00Z",
        "split-at": "2026-11-01T00:00:00Z",
      }),
    ).toEqual({
      error:
        "Invalid --split-at 2026-11-01T00:00:00.000Z: it is before --since 2026-11-10T00:00:00.000Z. Use a date inside the range, or move --since earlier.",
    });
  });

  it("refuses a split date after --until, because the after side would be silently empty", () => {
    vi.mocked(isTimestamp).mockReturnValue(true);

    expect(
      parseWindowFlags({
        until: "2026-11-10T00:00:00Z",
        "split-at": "2026-11-20T00:00:00Z",
      }),
    ).toEqual({
      error:
        "Invalid --split-at 2026-11-20T00:00:00.000Z: it is after --until 2026-11-10T00:00:00.000Z. Use a date inside the range, or move --until later.",
    });
  });
});

describe("parseIdeas", () => {
  it("reads issue numbers with or without a hash", () => {
    expect(parseIdeas("#12,13")).toEqual(["#12", "#13"]);
  });

  it("refuses anything that is not an issue number", () => {
    expect(parseIdeas("x")).toEqual({
      error: 'Invalid --idea "x". Use issue numbers such as #12 or 12,13.',
    });
  });
});
