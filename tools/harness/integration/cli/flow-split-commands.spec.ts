import { describe, expect, it } from "vitest";
import { run } from "../../src/cli/index.js";
import {
  LEDGER_FILE as DEFAULT,
  ledgerHarness as harness,
} from "../../src/testing/index.js";
import { finishedIdea } from "../../src/testing/index.js";
import {
  KEYS,
  SPLIT_KEYS,
  SPLIT_SIDE_KEYS,
} from "./flow-report-keys-support.js";

// finishedIdea events sit a few seconds after 2026-01-02T00:00:00Z.
const SPLIT = "2026-01-02T00:00:15Z";

function seeded(extra: string[] = []) {
  const h = harness();
  const events = [
    ...finishedIdea(1, { approval: 3000 }),
    ...finishedIdea(2, { approval: 1000 }, 10_000),
    ...finishedIdea(3, { approval: 2000 }, 20_000),
  ];
  h.fs.files.set(DEFAULT, events.map((e) => `${JSON.stringify(e)}\n`).join(""));
  return { h, argv: ["flow", "report", ...extra] };
}

describe("flow report --split-at (#1047)", () => {
  it("adds sendBackTiersSplit to the JSON and nothing else, with the tier figures of both sides", async () => {
    const { h, argv } = seeded(["--json", "--split-at", SPLIT]);

    expect(await run(argv, h.deps)).toBe(0);
    const report = JSON.parse(h.out()) as Record<string, unknown>;
    expect(Object.keys(report)).toEqual(SPLIT_KEYS);
    const split = report["sendBackTiersSplit"] as Record<string, unknown>;
    expect(Object.keys(split)).toEqual(SPLIT_SIDE_KEYS);
    expect(split["at"]).toBe("2026-01-02T00:00:15.000Z");
    const tierKeys = Object.keys(report["sendBackTiers"] as object);
    expect(Object.keys(split["before"] as object)).toEqual(tierKeys);
    expect(Object.keys(split["after"] as object)).toEqual(tierKeys);
  });

  it("keeps exactly the keys it had without the flag", async () => {
    const { h, argv } = seeded(["--json"]);

    expect(await run(argv, h.deps)).toBe(0);
    expect(Object.keys(JSON.parse(h.out()) as object)).toEqual(KEYS);
  });

  it("prints the two sides' tier lines in the text report, and none without the flag", async () => {
    const split = seeded(["--split-at", SPLIT]);
    await run(split.argv, split.h.deps);
    const plain = seeded();
    await run(plain.argv, plain.h.deps);

    expect(split.h.out()).toContain(
      "Send-backs by writer tier, before 2026-01-02T00:00:15.000Z:\n",
    );
    expect(split.h.out()).toContain(
      "Send-backs by writer tier, on or after 2026-01-02T00:00:15.000Z:\n",
    );
    expect(plain.h.out()).not.toContain("Send-backs by writer tier");
  });

  it("refuses a split date outside --since before reading the ledger", async () => {
    const { h, argv } = seeded([
      "--since",
      "2026-01-02T00:00:10Z",
      "--split-at",
      "2026-01-02T00:00:01Z",
    ]);

    expect(await run(argv, h.deps)).toBe(2);
    expect(h.err()).toContain("Invalid --split-at 2026-01-02T00:00:01.000Z");
  });
});
