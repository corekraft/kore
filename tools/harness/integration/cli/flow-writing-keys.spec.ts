import { describe, expect, it } from "vitest";
import { run } from "../../src/cli/index.js";
import {
  LEDGER_FILE as DEFAULT,
  ledgerHarness as harness,
  at,
  mainSplit,
} from "../../src/testing/index.js";
import {
  WRITING_BUCKET_KEYS,
  WRITING_KEYS,
  WRITING_SHARE_KEYS,
} from "./flow-report-keys-support.js";

const SONNET = "claude-sonnet-5-5";

/** `count` writers, each linked to a pull request with idea #7, with one reading apiece. */
async function writing(count: number) {
  const h = harness();
  const events = Array.from({ length: count }, (_, i) => {
    const agent = `w${i}-writer`;
    return [
      at(i, "session.launch", {
        agent,
        pane: `w1:p${i + 1}`,
        role: "writer",
        tier: SONNET,
      }),
      { ...mainSplit(i, agent, SONNET, 1000), agent },
      at(i, "pr.linked", {
        source: "herdr",
        number: 9 + i,
        session: agent,
        agent,
        idea: "#7",
      }),
    ];
  }).flat();
  h.fs.files.set(DEFAULT, events.map((e) => `${JSON.stringify(e)}\n`).join(""));
  expect(await run(["flow", "report", "--json"], h.deps)).toBe(0);
  return (
    JSON.parse(h.out()) as {
      costWaiting: { writing: Record<string, Record<string, unknown>> };
    }
  ).costWaiting.writing;
}

describe("flow report --json: the costWaiting.writing keys (#1093)", () => {
  it("pins the writing keys and each bucket's keys", async () => {
    const report = await writing(5);

    expect(Object.keys(report)).toEqual(WRITING_KEYS);
    for (const bucket of ["attributed", "noIdea", "noPullRequest"]) {
      expect(Object.keys(report[bucket] ?? {})).toEqual(WRITING_BUCKET_KEYS);
    }
  });

  it("pins the measured share's keys and figures at the minimum writer sessions", async () => {
    const report = await writing(5);

    expect(Object.keys(report["share"] ?? {})).toEqual(WRITING_SHARE_KEYS);
    expect(report["share"]).toEqual({
      status: "measured",
      share: 1,
      sessions: 5,
    });
  });

  it("pins the insufficient share's figures below the minimum, never a zero share", async () => {
    const report = await writing(1);

    expect(report["share"]).toEqual({
      status: "insufficient",
      sessions: 1,
      needed: 5,
    });
  });
});
