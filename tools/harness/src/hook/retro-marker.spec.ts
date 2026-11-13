// The `Last retrospective:` marker: which value wins, where the window opens,
// and how a value that is not a marker is refused.
// Docs: infra/plans/5-self-maintenance.md#step-2-deterministic-retrospective-scan

import { describe, expect, it } from "vitest";
import { lastRetrospective, windowStart } from "./retro-scan.js";

const FORM =
  "write a date (YYYY-MM-DD) or a UTC timestamp with date -u +%Y-%m-%dT%H:%M:%SZ";

const thrown = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "no error";
};

describe("lastRetrospective ordering", () => {
  it("picks the later of two timestamp markers on one day, whatever their order in the text", () => {
    expect(
      lastRetrospective({
        "3.md":
          "Last retrospective: 2026-11-12T18:00:00Z\n\nLast retrospective: 2026-11-12T10:00:00Z\n",
      }),
    ).toBe("2026-11-12T18:00:00Z");
  });

  it("ranks a bare date below a timestamp later that day", () => {
    expect(
      lastRetrospective({
        "3.md": "Last retrospective: 2026-11-12\n",
        "4.md": "Last retrospective: 2026-11-13T00:00:00Z\n",
      }),
    ).toBe("2026-11-13T00:00:00Z");
  });

  it("ranks a bare date above a timestamp from an earlier day", () => {
    expect(
      lastRetrospective({
        "3.md": "Last retrospective: 2026-11-12\n",
        "4.md": "Last retrospective: 2026-11-10T00:00:00Z\n",
      }),
    ).toBe("2026-11-12");
  });
});

describe("windowStart for a timestamp marker", () => {
  it("opens the window at the instant of the timestamp marker", () => {
    expect(windowStart("2026-11-12T18:00:00Z")).toBe(
      Date.parse("2026-11-12T18:00:00Z"),
    );
  });
});

describe("marker values that are refused", () => {
  it("rejects a near-miss timestamp with the plan line and the form to write, instead of reading its date", () => {
    const messages = [
      "2026-11-12 18:00:00Z",
      "2026-11-12T18:00:00.000Z",
      "2026-11-12T18:00:00+00:00",
      "2026-11-12T18:00Z",
    ].map((value) =>
      thrown(() =>
        lastRetrospective({ "3.md": `# Plan\nLast retrospective: ${value}\n` }),
      ),
    );
    expect(messages).toEqual([
      `3.md:2: "2026-11-12 18:00:00Z" is not a retrospective marker; ${FORM}`,
      `3.md:2: "2026-11-12T18:00:00.000Z" is not a retrospective marker; ${FORM}`,
      `3.md:2: "2026-11-12T18:00:00+00:00" is not a retrospective marker; ${FORM}`,
      `3.md:2: "2026-11-12T18:00Z" is not a retrospective marker; ${FORM}`,
    ]);
  });

  it("throws for hour 25 instead of reading NaN, so no later marker is hidden behind it", () => {
    expect(
      thrown(() =>
        lastRetrospective({
          "3.md": "# Plan\nLast retrospective: 2026-11-12T25:00:00Z\n",
        }),
      ),
    ).toBe(
      `3.md:2: "2026-11-12T25:00:00Z" is not a retrospective marker; ${FORM}`,
    );
  });

  it("throws for month 13 instead of reading NaN", () => {
    expect(
      thrown(() =>
        lastRetrospective({
          "3.md": "# Plan\nLast retrospective: 2026-13-45\n",
        }),
      ),
    ).toBe(`3.md:2: "2026-13-45" is not a retrospective marker; ${FORM}`);
  });

  it("throws for February 30 instead of rolling it over to March 2", () => {
    expect(
      thrown(() =>
        lastRetrospective({
          "3.md": "# Plan\nLast retrospective: 2026-02-30\n",
        }),
      ),
    ).toBe(`3.md:2: "2026-02-30" is not a retrospective marker; ${FORM}`);
  });

  it("throws for a value windowStart cannot open a window at", () => {
    expect(thrown(() => windowStart("2026-13-45"))).toBe(
      `"2026-13-45" is not a retrospective marker; ${FORM}`,
    );
  });
});
