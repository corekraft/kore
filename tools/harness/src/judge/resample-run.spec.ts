import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  RESAMPLE_EFFORT,
  RESAMPLE_MODEL,
  RESAMPLE_REASON,
  type ResampleCandidate,
} from "./resample.js";
import { ResampleRun, type ResamplePorts } from "./resample-run.js";
import { readVerdict } from "./review-verdict-read.js";

vi.mock("./review-verdict-read.js", () => ({
  readVerdict: vi.fn<(text: string) => string[] | undefined>(),
}));

const A: ResampleCandidate = { pr: 10, head: "aaaaaaaa" };
const B: ResampleCandidate = { pr: 11, head: "bbbbbbbb" };

interface Fakes {
  ports: ResamplePorts;
  spawn: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  record: ReturnType<typeof vi.fn>;
}

/** Ports where every pane ends done with a pane text; the caller overrides what it tests. */
function fakes(overrides: Partial<ResamplePorts> = {}): Fakes {
  const spawn = vi.fn(async () => undefined);
  const close = vi.fn(async () => undefined);
  const record = vi.fn(async () => undefined);
  const ports: ResamplePorts = {
    spawn,
    wait: async () => ({ outcome: "done" }),
    read: async () => "some text",
    close,
    record,
    ...overrides,
  };
  return { ports, spawn, close, record };
}

beforeEach(() => {
  vi.mocked(readVerdict).mockReset();
});

describe("ResampleRun launch (#852)", () => {
  it("launches a Sonnet reader for the head, recording the override tier and its reason", async () => {
    const f = fakes();
    await new ResampleRun(f.ports).run([A]);

    expect(f.spawn).toHaveBeenCalledWith({
      name: "resample-pr10-aaaaaaaa",
      role: "reader",
      model: RESAMPLE_MODEL,
      effort: RESAMPLE_EFFORT,
      reason: RESAMPLE_REASON,
      brief: expect.stringContaining("PR #10 at head aaaaaaaa"),
    });
  });

  it("asks an hc reader for its verdict on the stdin of session report, on one line, and never for a RESULT line", async () => {
    const f = fakes();
    vi.mocked(readVerdict).mockReturnValue([]);
    await new ResampleRun(f.ports, "hc").run([A]);

    const brief = f.spawn.mock.calls[0]?.[0].brief as string;
    expect(brief).not.toContain("\n");
    expect(brief).toContain(
      "run `harness session report --outcome done --summary - <<'EOF'`, with your verdict lines on the lines after it",
    );
    expect(brief).not.toMatch(/RESULT/);
  });

  it("sends a one-line brief, so no line of it can read as a verdict marker", async () => {
    const f = fakes();
    await new ResampleRun(f.ports).run([A]);

    const brief = f.spawn.mock.calls[0]?.[0].brief as string;
    expect(brief).not.toContain("\n");
    expect(brief).toContain("Do not post anything");
  });
});

describe("ResampleRun verdict (#852)", () => {
  it("records a clean re-review as resample:<head> with zero findings", async () => {
    vi.mocked(readVerdict).mockReturnValue([]);
    const f = fakes();

    const result = await new ResampleRun(f.ports).run([A]);

    expect(f.record).toHaveBeenCalledWith(10, "resample:aaaaaaaa", 0);
    expect(result.reviewed).toEqual([
      { pr: 10, head: "aaaaaaaa", findings: 0 },
    ]);
  });

  it("records a re-review that found violations with the count of findings", async () => {
    vi.mocked(readVerdict).mockReturnValue([
      "a.ts:1 | r | x | y",
      "b.ts:2 | r | x | y",
    ]);
    const f = fakes();

    const result = await new ResampleRun(f.ports).run([A]);

    expect(f.record).toHaveBeenCalledWith(10, "resample:aaaaaaaa", 2);
    expect(result.reviewed).toEqual([
      { pr: 10, head: "aaaaaaaa", findings: 2 },
    ]);
  });

  it("reads the text of the session it waited on, by its name, so the verdict comes from that session", async () => {
    vi.mocked(readVerdict).mockReturnValue([]);
    const read = vi.fn(async () => "pane text");
    const f = fakes({
      wait: async () => ({ outcome: "done" }),
      read,
    });

    await new ResampleRun(f.ports).run([A]);

    expect(read).toHaveBeenCalledWith("resample-pr10-aaaaaaaa");
    expect(readVerdict).toHaveBeenCalledWith("pane text");
  });
});

describe("ResampleRun failures (#852)", () => {
  it("records a blocked re-review as resample-failed:<head> and carries on to the next PR", async () => {
    vi.mocked(readVerdict).mockReturnValue([]);
    let calls = 0;
    const f = fakes({
      wait: async () => {
        calls++;
        return calls === 1 ? { outcome: "blocked" } : { outcome: "done" };
      },
    });

    const result = await new ResampleRun(f.ports).run([A, B]);

    expect(f.record).toHaveBeenCalledWith(10, "resample-failed:aaaaaaaa");
    expect(f.record).toHaveBeenCalledWith(11, "resample:bbbbbbbb", 0);
    expect(result.failed).toEqual([
      { pr: 10, head: "aaaaaaaa", reason: "blocked" },
    ]);
    expect(result.reviewed).toEqual([
      { pr: 11, head: "bbbbbbbb", findings: 0 },
    ]);
  });

  it("records a re-review with no verdict as a failure, never as a clean pass", async () => {
    vi.mocked(readVerdict).mockReturnValue(undefined);
    const f = fakes();

    const result = await new ResampleRun(f.ports).run([A]);

    expect(f.record).toHaveBeenCalledWith(10, "resample-failed:aaaaaaaa");
    expect(f.record).not.toHaveBeenCalledWith(10, "resample:aaaaaaaa", 0);
    expect(result.failed).toEqual([
      { pr: 10, head: "aaaaaaaa", reason: "no verdict" },
    ]);
  });

  it("closes the pane even when the wait fails, so no reader is left running", async () => {
    const f = fakes({
      wait: async () => {
        throw new Error("herdr is gone");
      },
    });

    await expect(new ResampleRun(f.ports).run([A])).rejects.toThrow(
      "herdr is gone",
    );
    expect(f.close).toHaveBeenCalledWith("resample-pr10-aaaaaaaa");
  });

  it("launches nothing for an empty sample", async () => {
    const f = fakes();

    const result = await new ResampleRun(f.ports).run([]);

    expect(f.spawn).not.toHaveBeenCalled();
    expect(result).toEqual({ reviewed: [], failed: [] });
  });
});
