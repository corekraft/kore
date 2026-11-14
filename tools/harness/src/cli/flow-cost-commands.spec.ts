import { describe, expect, it } from "vitest";
import { run } from "./cli.js";
import { DEFAULT, harness } from "./ledger-commands-support.js";
import { finishedIdea } from "../testing/index.js";

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

describe("flow report cost metrics", () => {
  function costed(extra: string[] = []) {
    const { h, argv } = seeded(["--json", ...extra]);
    return { h, argv };
  }

  it("prints insufficient history, never zero, with fewer closed ideas than N", async () => {
    const { h, argv } = costed();
    expect(await run(argv, h.deps)).toBe(0);
    const { metrics } = JSON.parse(h.out()) as { metrics: unknown };
    expect(metrics).toMatchObject({
      trailingIdeas: 5,
      tokensPerIdea: {
        status: "insufficient history",
        closedIdeas: 0,
        needed: 6,
      },
      sessionsPerIdea: {
        status: "insufficient history",
        closedIdeas: 3,
        needed: 6,
      },
    });
  });

  it("takes N from --trailing and shows the numbers in the human report", async () => {
    const { h, argv } = seeded(["--trailing", "2"]);
    expect(await run(argv, h.deps)).toBe(0);
    expect(h.out()).toContain(
      "Tokens per idea: insufficient history, 0 of 3 closed ideas",
    );
    expect(h.out()).toContain(
      "Sessions per idea: #3 0, average of the 2 ideas before it 0",
    );
    const insufficient = seeded();
    await run(insufficient.argv, insufficient.h.deps);
    expect(insufficient.h.out()).toContain(
      "Sessions per idea: insufficient history, 3 of 6 closed ideas",
    );
  });
});

describe("flow report cost metrics config", () => {
  const CONFIG = "/repo/.claude/harness.json";

  function costed(extra: string[] = []) {
    const { h, argv } = seeded(["--json", ...extra]);
    return { h, argv };
  }

  it("takes N and thresholds from the harness config", async () => {
    const { h, argv } = costed();
    h.fs.files.set(
      CONFIG,
      JSON.stringify({
        cost: { trailingIdeas: 2, sessionsPerIdea: { maxIncrease: 1 } },
      }),
    );
    await run(argv, h.deps);
    const { metrics } = JSON.parse(h.out()) as { metrics: unknown };
    expect(metrics).toMatchObject({
      trailingIdeas: 2,
      sessionsPerIdea: { status: "ok", maxIncrease: 1 },
    });
  });

  it("fails before reading the ledger on a bad threshold, naming file, key and fix", async () => {
    const { h, argv } = costed();
    h.fs.files.set(
      CONFIG,
      JSON.stringify({ cost: { tokensPerIdea: { maxIncrease: -2 } } }),
    );
    expect(await run(argv, h.deps)).toBe(1);
    expect(h.out()).toBe("");
    expect(h.err()).toContain(".claude/harness.json");
    expect(h.err()).toContain("cost.tokensPerIdea.maxIncrease");
    expect(h.err()).toContain("Fix");
  });

  it.each(["0", "x", "2.5"])("rejects --trailing %s", async (value) => {
    const { h, argv } = costed(["--trailing", value]);
    expect(await run(argv, h.deps)).toBe(2);
    expect(h.err()).toContain("Invalid --trailing");
  });
});
