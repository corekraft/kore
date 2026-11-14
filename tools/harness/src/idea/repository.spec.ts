import { describe, expect, it, vi } from "vitest";
import type { Clock, FileSystem } from "../runtime/index.js";
import { withOutcome, type IdeaRecord } from "./record.js";
import { IdeaRepository } from "./repository.js";

vi.mock("./record.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./record.js")>()),
  withOutcome: vi.fn(),
}));

const ROOT = "/repo";
const RECORD: IdeaRecord = {
  number: "0001",
  slug: "cache-the-probe-results",
  path: "docs/ideas/0001-cache-the-probe-results.md",
  title: "Cache the probe results",
  summary: "Probes repeat work.",
  hypothesis: "Caching cuts up time.",
  expectedOutcome: "Up time falls below 30s.",
  measurement: "kore local up p50 before and after.",
  safetyPattern: "no-behaviour-change",
  date: "2026-11-01",
};
const IDEA_TEXT = "---\ntitle: x\n---\n\nBody.\n";

/** A file system with the two calls recordOutcome makes; the cast stands in for the rest. */
function fakeFileSystem() {
  const fs = {
    readFile: vi.fn<FileSystem["readFile"]>(() => Promise.resolve(IDEA_TEXT)),
    writeFile: vi.fn<FileSystem["writeFile"]>(() => Promise.resolve()),
  };
  return { fs: fs as unknown as FileSystem, calls: fs };
}

describe("IdeaRepository.recordOutcome", () => {
  it("reads the idea under the root, writes back the text withOutcome returns, and nothing else", async () => {
    const { fs, calls } = fakeFileSystem();
    const clock: Clock = {
      now: vi.fn<Clock["now"]>(() => new Date("2026-11-14T08:30:00Z")),
      sleep: vi.fn<Clock["sleep"]>(() => Promise.resolve()),
    };
    vi.mocked(withOutcome).mockReturnValue("WITH OUTCOME");
    const repo = new IdeaRepository(fs, clock, ROOT);
    await repo.recordOutcome(RECORD, "confirmed", "## Outcome\n\nBODY");

    expect(calls.readFile.mock.calls).toEqual([
      ["/repo/docs/ideas/0001-cache-the-probe-results.md"],
    ]);
    expect(withOutcome).toHaveBeenCalledWith(
      IDEA_TEXT,
      "confirmed",
      "## Outcome\n\nBODY",
    );
    expect(calls.writeFile.mock.calls).toEqual([
      ["/repo/docs/ideas/0001-cache-the-probe-results.md", "WITH OUTCOME"],
    ]);
  });
});
