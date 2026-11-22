import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ResampleCandidate,
  ResamplePorts,
  ResampleResult,
} from "../judge/index.js";
import type { LedgerEvent } from "../ledger/index.js";
import { briefBackend } from "../session/index.js";
import { fakeContext } from "./command-support.js";
import {
  reviewResampleRun,
  type ResampleIo,
} from "./review-resample-command.js";

const { run, sample, pool, constructed } = vi.hoisted(() => ({
  constructed: vi.fn<(...args: unknown[]) => void>(),
  run: vi.fn<(sample: ResampleCandidate[]) => Promise<ResampleResult>>(),
  sample:
    vi.fn<
      (
        pool: readonly ResampleCandidate[],
        size: number,
        random: () => number,
      ) => ResampleCandidate[]
    >(),
  pool: vi.fn<(events: LedgerEvent[]) => ResampleCandidate[]>(),
}));

vi.mock("../session/index.js", () => ({
  briefBackend: vi.fn<(deps: unknown) => Promise<"herdr" | "hc">>(),
}));
vi.mock("../judge/index.js", async (original) => ({
  ...(await original<typeof import("../judge/index.js")>()),
  resampleCandidates: pool,
  drawSample: sample,
  ResampleRun: class {
    constructor(...args: unknown[]) {
      constructed(...args);
    }
    run = run;
  },
}));

const ONE: ResampleCandidate = { pr: 10, head: "aaaaaaaa" };
const TWO: ResampleCandidate = { pr: 11, head: "bbbbbbbb" };
const EVENTS = [] as LedgerEvent[];
const random = () => 0.5;
const PORTS = {} as ResamplePorts;

/** A load that counts its calls, so a refused command can show it read nothing. */
function loader() {
  return vi.fn<() => Promise<ResampleIo>>(async () => ({
    events: EVENTS,
    ports: PORTS,
  }));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(briefBackend).mockResolvedValue("herdr");
  pool.mockReturnValue([ONE, TWO]);
  sample.mockReturnValue([TWO]);
  run.mockResolvedValue({
    reviewed: [{ pr: 11, head: "bbbbbbbb", findings: 0 }],
    failed: [],
  });
});

describe("review resample: the sample it re-reviews (#852)", () => {
  it("draws the default-size sample from the ledger's passed reviews and re-reviews only it", async () => {
    const load = loader();
    const { context } = fakeContext();

    expect(await reviewResampleRun(context, load, random)).toBe(0);
    expect(pool).toHaveBeenCalledWith(EVENTS);
    expect(sample).toHaveBeenCalledWith([ONE, TWO], 5, random);
    expect(run).toHaveBeenCalledWith([TWO]);
  });

  it("takes the sample size from --size", async () => {
    const { context } = fakeContext({ options: { size: "3" } });

    await reviewResampleRun(context, loader(), random);

    expect(sample).toHaveBeenCalledWith([ONE, TWO], 3, random);
  });

  it("refuses a size that is not a whole number of 1 or more, before reading the ledger or starting a pane", async () => {
    const load = loader();
    const { context, err } = fakeContext({ options: { size: "0" } });

    expect(await reviewResampleRun(context, load, random)).toBe(1);
    expect(err()).toContain("--size must be a whole number of 1 or more");
    expect(load).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("starts no pane and says so when no passed review is waiting for a re-review", async () => {
    sample.mockReturnValue([]);
    const { context, out } = fakeContext();

    expect(await reviewResampleRun(context, loader(), random)).toBe(0);
    expect(out()).toBe(
      "No passed review of a merged PR is waiting for a re-review, so no reader was started\n",
    );
  });
});

describe("review resample: what it reports (#852)", () => {
  it("prints the re-reviews that read a verdict, with the findings each found", async () => {
    run.mockResolvedValue({
      reviewed: [{ pr: 11, head: "bbbbbbbb", findings: 2 }],
      failed: [],
    });
    const { context, out } = fakeContext();

    await reviewResampleRun(context, loader(), random);

    expect(out()).toBe(
      "Re-reviewed 1 sampled passed review: 1 found a violation, 0 failed\n  PR #11 at head bbbbbbbb: 2 findings\n",
    );
  });

  it("prints a failed re-review by its reason, and never counts it as passed", async () => {
    run.mockResolvedValue({
      reviewed: [],
      failed: [{ pr: 11, head: "bbbbbbbb", reason: "blocked" }],
    });
    const { context, out } = fakeContext();

    await reviewResampleRun(context, loader(), random);

    expect(out()).toBe(
      "Re-reviewed 0 sampled passed reviews: 0 found a violation, 1 failed\n  PR #11 at head bbbbbbbb: failed (blocked)\n",
    );
  });

  it("prints the sample and the results as one JSON object with --json", async () => {
    const { context, out } = fakeContext({ json: true });

    await reviewResampleRun(context, loader(), random);

    expect(out()).toBe(
      `${JSON.stringify({
        sample: [TWO],
        reviewed: [{ pr: 11, head: "bbbbbbbb", findings: 0 }],
        failed: [],
      })}\n`,
    );
  });
});

describe("review resample: the backend its readers are briefed and read for (hc-sessions)", () => {
  it("loads the ports for the backend the flag names, and re-reviews through that backend", async () => {
    vi.mocked(briefBackend).mockResolvedValue("hc");
    const load = loader();
    const { context } = fakeContext();

    await reviewResampleRun(context, load, random);

    expect(load).toHaveBeenCalledWith("hc");
    expect(constructed).toHaveBeenCalledWith(PORTS, "hc");
  });
});
