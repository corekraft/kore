import { describe, expect, it } from "vitest";
import { run } from "./cli.js";
import { DEFAULT, harness } from "./ledger-commands-support.js";
import { finishedIdea } from "../flow/flow-support.js";

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

const KEYS = [
  "version",
  "asOf",
  "scope",
  "ideas",
  "minCompletedIdeas",
  "stages",
  "leadTime",
  "bottleneck",
  "bottleneckNote",
  "unmappedEvents",
  "skippedLines",
];

describe("flow report", () => {
  it("prints the versioned JSON shape with the named bottleneck", async () => {
    const { h, argv } = seeded(["--json"]);
    expect(await run(argv, h.deps)).toBe(0);
    const report = JSON.parse(h.out()) as Record<string, unknown>;
    expect(Object.keys(report)).toEqual(KEYS);
    expect(report).toMatchObject({ bottleneckNote: null });
    expect(report).toMatchObject({
      version: 4,
      asOf: "2026-01-02T03:04:05.000Z",
      ideas: { total: 3, completed: 3 },
      minCompletedIdeas: 3,
      bottleneck: { stage: "await approval" },
      skippedLines: 0,
    });
  });

  it("prints a table and the bottleneck in plain text", async () => {
    const { h, argv } = seeded();
    expect(await run(argv, h.deps)).toBe(0);
    expect(h.out()).toContain("await approval");
    expect(h.out()).toMatch(/Bottleneck: await approval \(\d+% of waiting\)/);
  });

  it("says there is not enough data instead of naming a bottleneck", async () => {
    const { h, argv } = seeded(["--min-ideas", "4"]);
    expect(await run(argv, h.deps)).toBe(0);
    expect(h.out()).toContain(
      "Not enough data: 3 of 4 completed ideas needed to name a bottleneck.",
    );
    expect(h.out()).not.toContain("Bottleneck:");
  });

  it("emits the same keys when there is not enough data", async () => {
    const { h, argv } = seeded(["--json", "--min-ideas", "4"]);
    await run(argv, h.deps);
    const report = JSON.parse(h.out()) as Record<string, unknown>;
    expect(Object.keys(report)).toEqual(KEYS);
    expect(report).toMatchObject({
      bottleneck: null,
      bottleneckNote:
        "Not enough data: 3 of 4 completed ideas needed to name a bottleneck.",
    });
  });

  it("reports an empty or missing ledger without inventing a bottleneck", async () => {
    const h = harness();
    expect(await run(["flow", "report", "--json"], h.deps)).toBe(0);
    expect(JSON.parse(h.out())).toMatchObject({
      ideas: { total: 0, completed: 0 },
      bottleneck: null,
    });
  });

  it("counts malformed ledger lines as skipped", async () => {
    const h = harness();
    h.fs.files.set(DEFAULT, "not json\n");
    await run(["flow", "report", "--json"], h.deps);
    expect(JSON.parse(h.out())).toMatchObject({ skippedLines: 1 });
    const text = harness();
    text.fs.files.set(DEFAULT, "not json\n");
    await run(["flow", "report"], text.deps);
    expect(text.out()).toContain("skipped 1 malformed ledger line(s)");
  });
});

describe("flow report flags", () => {
  it("measures open waits to --as-of", async () => {
    const h = harness();
    h.fs.files.set(
      DEFAULT,
      `${JSON.stringify({ schema: 1, id: "a", source: "github", kind: "issue.opened", occurredAt: "2026-01-02T00:00:00.000Z", recordedAt: "2026-01-02T00:00:00.000Z", number: 1 })}\n`,
    );
    await run(
      ["flow", "report", "--json", "--as-of", "2026-01-02T01:00:00Z"],
      h.deps,
    );
    const report = JSON.parse(h.out()) as {
      stages: { stage: string; waitingSeconds: number }[];
    };
    expect(
      report.stages.find((s) => s.stage === "await approval")?.waitingSeconds,
    ).toBe(3600);
  });

  it.each([
    [["--min-ideas", "0"], "--min-ideas"],
    [["--min-ideas", "x"], "--min-ideas"],
    [["--as-of", "yesterday"], "--as-of"],
  ])("rejects a bad flag %j before reading the ledger", async (flags, name) => {
    const h = harness();
    expect(await run(["flow", "report", ...flags], h.deps)).toBe(2);
    expect(h.err()).toContain(`Invalid ${name}`);
  });

  it("fails clearly when the shared ledger cannot be located", async () => {
    const h = harness("", { commonDir: undefined });
    expect(await run(["flow", "report"], h.deps)).toBe(1);
    expect(h.err()).toContain("main checkout root");
  });
});

describe("flow report toil", () => {
  it("prints toil of every kind under each stage in the JSON", async () => {
    const { h, argv } = seeded(["--json"]);
    expect(await run(argv, h.deps)).toBe(0);
    const { stages } = JSON.parse(h.out()) as {
      stages: { toil: Record<string, number> }[];
    };
    for (const stage of stages) {
      expect(Object.keys(stage.toil)).toEqual([
        "startingSeconds",
        "stoppingSeconds",
        "waitingSeconds",
        "retryingSeconds",
      ]);
    }
  });
});

describe("flow report work in progress and lead time", () => {
  it("prints wip per stage and lead time in the JSON", async () => {
    const { h, argv } = seeded(["--json"]);
    expect(await run(argv, h.deps)).toBe(0);
    const { stages, leadTime } = JSON.parse(h.out()) as {
      stages: { wip: Record<string, number> }[];
      leadTime: { ideas: unknown[]; medianSeconds: number; maxSeconds: number };
    };
    for (const stage of stages) {
      expect(Object.keys(stage.wip)).toEqual(["peak", "average"]);
    }
    expect(leadTime.ideas).toHaveLength(3);
    expect(leadTime.maxSeconds).toBeGreaterThanOrEqual(leadTime.medianSeconds);
  });

  it("prints wip per stage and a lead time line in plain text", async () => {
    const { h, argv } = seeded();
    expect(await run(argv, h.deps)).toBe(0);
    expect(h.out()).toMatch(/wip peak \d+ avg \d/);
    expect(h.out()).toMatch(/Lead time: 3 ideas, median \d+s, max \d+s/);
  });

  it("says no idea has an outcome yet when none completed", async () => {
    const h = harness();
    h.fs.files.set(DEFAULT, "");
    expect(await run(["flow", "report"], h.deps)).toBe(0);
    expect(h.out()).toContain("Lead time: no completed ideas");
  });
});

describe("flow report range and ideas", () => {
  it("reports only the named ideas and says so", async () => {
    const { h, argv } = seeded(["--json", "--idea", "#2,#3"]);
    expect(await run(argv, h.deps)).toBe(0);
    expect(JSON.parse(h.out())).toMatchObject({
      scope: { since: null, until: null, ideas: ["#2", "#3"] },
      ideas: { total: 2, completed: 2 },
    });
  });

  it("accepts an idea written as a bare issue number", async () => {
    const { h, argv } = seeded(["--json", "--idea", "2"]);
    expect(await run(argv, h.deps)).toBe(0);
    expect(JSON.parse(h.out())).toMatchObject({
      scope: { ideas: ["#2"] },
      ideas: { total: 1 },
    });
  });

  it("reads an idea written with leading zeros as the same issue", async () => {
    const { h, argv } = seeded(["--json", "--idea", "#002"]);
    expect(await run(argv, h.deps)).toBe(0);
    expect(JSON.parse(h.out())).toMatchObject({
      scope: { ideas: ["#2"] },
      ideas: { total: 1 },
    });
  });

  it("reports only the time range and says so", async () => {
    const { h, argv } = seeded([
      "--json",
      "--since",
      "2026-01-02T02:00:00Z",
      "--until",
      "2026-01-02T04:00:00Z",
    ]);
    expect(await run(argv, h.deps)).toBe(0);
    expect(JSON.parse(h.out())).toMatchObject({
      scope: {
        since: "2026-01-02T02:00:00.000Z",
        until: "2026-01-02T04:00:00.000Z",
        ideas: null,
      },
      ideas: { total: 1 },
    });
  });
});

describe("flow report scope text and flags", () => {
  it("states the range and ideas in plain text", async () => {
    const { h, argv } = seeded([
      "--since",
      "2026-01-02T00:00:00Z",
      "--idea",
      "#1",
    ]);
    expect(await run(argv, h.deps)).toBe(0);
    expect(h.out()).toContain(
      "Covering from 2026-01-02T00:00:00.000Z, ideas #1",
    );
  });

  it("says it covers the whole ledger when nothing narrows it", async () => {
    const { h, argv } = seeded();
    await run(argv, h.deps);
    expect(h.out()).toContain("Covering the whole ledger");
  });

  it.each([
    [["--since", "last week"], "--since"],
    [["--until", "2026-01-02"], "--until"],
    [["--idea", "abc"], "--idea"],
    [["--idea", ""], "--idea"],
    [
      ["--since", "2026-01-03T00:00:00Z", "--until", "2026-01-02T00:00:00Z"],
      "--since",
    ],
  ])("rejects a bad flag %j before reading the ledger", async (flags, name) => {
    // With no shared ledger to locate, reading it would fail with a different message.
    const h = harness("", { commonDir: undefined });
    expect(await run(["flow", "report", ...flags], h.deps)).toBe(2);
    expect(h.err()).toContain(`Invalid ${name}`);
    expect(h.err()).not.toContain("main checkout root");
  });
});
