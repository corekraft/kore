import { beforeEach, describe, expect, it, vi } from "vitest";
import { RetroFiling, type FilingPorts } from "./retro-filing.js";
import {
  PROPOSALS_BEGIN,
  PROPOSALS_END,
  checkBatch,
  contentOf,
  readProposals,
  type Proposal,
} from "./retro-proposals.js";

vi.mock("./retro-proposals.js", async (original) => ({
  ...(await original<typeof import("./retro-proposals.js")>()),
  readProposals: vi.fn(),
  checkBatch: vi.fn(),
  contentOf: vi.fn(),
}));

const proposal = (title: string): Proposal => ({
  title,
  hypothesis: "h",
  expectedOutcome: "e",
  measurement: "m",
  safetyPattern: "no-behaviour-change",
  metric: "friction.total",
  direction: "down",
  window: "14d",
});

const TRIGGER = "retro-20261115-0930";

function ports(script: { flag?: boolean; existing?: string[] } = {}) {
  const calls: string[] = [];
  const fake: FilingPorts = {
    flagOn: () => {
      calls.push("flag");
      return Promise.resolve(script.flag ?? true);
    },
    metricNames: () => Promise.resolve(["friction.total"]),
    hash: (text) => `h${text.length}`,
    file: (slug, p) => {
      calls.push(`file ${slug} ${p.title}`);
      return Promise.resolve({
        created: !(script.existing ?? []).includes(slug),
        number: "0042",
      });
    },
    recordFiled: (number, key) => {
      calls.push(`filed ${number} ${key}`);
      return Promise.resolve();
    },
    recordDropped: (trigger, count) => {
      calls.push(`dropped ${trigger} ${count}`);
      return Promise.resolve();
    },
  };
  return { fake, calls };
}

beforeEach(() => {
  vi.mocked(readProposals).mockReturnValue({ ok: true, batch: "raw" });
  vi.mocked(contentOf).mockImplementation((p) => `content-${p.title}`);
});

const accept = (...titles: string[]) =>
  vi.mocked(checkBatch).mockReturnValue({
    ok: true,
    proposals: titles.map(proposal),
  });

describe("RetroFiling", () => {
  it("files nothing and reads nothing while the flag is off", async () => {
    const { fake, calls } = ports({ flag: false });

    expect(await new RetroFiling(fake).run(TRIGGER, "pane")).toEqual({
      status: "flag-off",
    });
    expect(calls).toEqual(["flag"]);
    expect(readProposals).not.toHaveBeenCalled();
  });

  it("files each proposal under the trigger plus a content hash and records the filing", async () => {
    accept("a", "b");
    const { fake, calls } = ports();

    const result = await new RetroFiling(fake).run(TRIGGER, "pane");

    expect(calls).toEqual([
      "flag",
      `file ${TRIGGER}-h9 a`,
      `filed 0042 ${TRIGGER}-h9`,
      `file ${TRIGGER}-h9 b`,
      `filed 0042 ${TRIGGER}-h9`,
    ]);
    expect(result).toEqual({
      status: "filed",
      filed: 2,
      existing: 0,
      dropped: 0,
    });
  });

  it("records no event for an idea a rerun finds already filed", async () => {
    accept("a");
    const { fake, calls } = ports({ existing: [`${TRIGGER}-h9`] });

    const result = await new RetroFiling(fake).run(TRIGGER, "pane");

    expect(result).toEqual({
      status: "filed",
      filed: 0,
      existing: 1,
      dropped: 0,
    });
    expect(calls.filter((c) => c.startsWith("filed"))).toEqual([]);
  });

  it("files the first 5 and records the rest as dropped", async () => {
    accept("1", "2", "3", "4", "5", "6", "7");
    const { fake, calls } = ports();

    const result = await new RetroFiling(fake).run(TRIGGER, "pane");

    expect(calls.filter((c) => c.startsWith("file "))).toHaveLength(5);
    expect(calls).not.toContain(`file ${TRIGGER}-h9 6`);
    expect(calls.at(-1)).toBe(`dropped ${TRIGGER} 2`);
    expect(result).toMatchObject({ filed: 5, dropped: 2 });
  });

  it("records no dropped count when the cap dropped nothing", async () => {
    accept("1", "2", "3", "4", "5");
    const { fake, calls } = ports();

    await new RetroFiling(fake).run(TRIGGER, "pane");

    expect(calls.some((c) => c.startsWith("dropped"))).toBe(false);
  });
});

describe("RetroFiling refusals", () => {
  it("refuses the whole batch with the check's message, filing nothing", async () => {
    vi.mocked(checkBatch).mockReturnValue({
      ok: false,
      error: "Proposal 2 bad",
    });
    const { fake, calls } = ports();

    expect(await new RetroFiling(fake).run(TRIGGER, "pane")).toEqual({
      status: "refused",
      error: "Proposal 2 bad",
    });
    expect(calls).toEqual(["flag"]);
  });

  it("refuses when the pane printed no readable proposals, filing nothing", async () => {
    vi.mocked(readProposals).mockReturnValue({ ok: false, error: "no JSON" });
    const { fake, calls } = ports();

    expect(await new RetroFiling(fake).run(TRIGGER, "pane")).toEqual({
      status: "refused",
      error: "no JSON",
    });
    expect(calls).toEqual(["flag"]);
    expect(checkBatch).not.toHaveBeenCalled();
  });

  it("hands the pane text to the reader, and the metric names to the check", async () => {
    accept();
    const { fake } = ports();

    await new RetroFiling(fake).run(
      TRIGGER,
      `${PROPOSALS_BEGIN}\n${PROPOSALS_END}`,
    );

    expect(readProposals).toHaveBeenCalledWith(
      `${PROPOSALS_BEGIN}\n${PROPOSALS_END}`,
    );
    expect(checkBatch).toHaveBeenCalledWith(
      "raw",
      ["friction.total"],
      expect.arrayContaining(["no-behaviour-change"]),
    );
  });
});
