import { describe, expect, it } from "vitest";
import { CommandError } from "../runtime/index.js";
import { fakeFileSystem } from "./deps-support.js";
import {
  isInsideReportDir,
  noticeLine,
  readReport,
  reportDirOf,
  reportPath,
} from "./report-file.js";

const WORK = "/work/writer";
const REPORT = "/work/writer/.kore/report/image-trust-writer.json";
const VALID = {
  seq: 2,
  outcome: "done",
  summary: "Opened PR #5.",
  at: "2026-01-02T03:04:05.000Z",
};

describe("reportPath names the report after its session, under the checkout's .kore/report", () => {
  it("builds the file name from the session name and the terminal's checkout", () => {
    expect(reportPath(WORK, "image-trust-writer")).toBe(REPORT);
    expect(reportDirOf(WORK)).toBe("/work/writer/.kore/report");
  });
});

describe("isInsideReportDir refuses any path outside the report directory", () => {
  it.each([
    [
      "a file in the report directory",
      "/work/writer/.kore/report/summary.md",
      true,
    ],
    ["the report directory itself", "/work/writer/.kore/report", false],
    [
      "a file beside the report directory",
      "/work/writer/.kore/summary.md",
      false,
    ],
    [
      "a path that climbs out of it",
      "/work/writer/.kore/report/../../secret.md",
      false,
    ],
    [
      "a sibling directory that shares its prefix",
      "/work/writer/.kore/report-old/x.md",
      false,
    ],
    [
      "a file whose name starts with two dots",
      "/work/writer/.kore/report/..notes.md",
      true,
    ],
  ])("is true only for %s (%s)", (_label, path, inside) => {
    expect(isInsideReportDir(WORK, path)).toBe(inside);
  });
});

describe("readReport", () => {
  it("returns undefined, without reading, when no report exists yet", async () => {
    const fs = fakeFileSystem();
    fs.exists.mockResolvedValue(false);

    expect(await readReport(fs, REPORT)).toBeUndefined();
    expect(fs.readFile).not.toHaveBeenCalled();
  });

  it("returns the report the file holds", async () => {
    const fs = fakeFileSystem();
    fs.exists.mockResolvedValue(true);
    fs.readFile.mockResolvedValue(JSON.stringify(VALID));

    expect(await readReport(fs, REPORT)).toStrictEqual(VALID);
  });

  it("keeps the plan text when the report holds one", async () => {
    const fs = fakeFileSystem();
    fs.exists.mockResolvedValue(true);
    fs.readFile.mockResolvedValue(JSON.stringify({ ...VALID, plan: "PLAN" }));

    expect(await readReport(fs, REPORT)).toStrictEqual({
      ...VALID,
      plan: "PLAN",
    });
  });

  it.each([
    ["not JSON", "not json"],
    [
      "a shape that is not a report",
      JSON.stringify({ seq: 0, outcome: "maybe" }),
    ],
  ])("refuses, naming the file, a file that is %s", async (_label, text) => {
    const fs = fakeFileSystem();
    fs.exists.mockResolvedValue(true);
    fs.readFile.mockResolvedValue(text);

    await expect(readReport(fs, REPORT)).rejects.toThrow(
      new CommandError(
        `Report ${REPORT} is not a valid session report; delete it and run session report again.`,
      ),
    );
  });
});

describe("noticeLine is the fixed one-line notice, with no summary in it", () => {
  it("is the name, outcome, seq and report path, in that shape", () => {
    expect(noticeLine("image-trust-writer", "done", 2, REPORT)).toBe(
      "image-trust-writer done seq 2: /work/writer/.kore/report/image-trust-writer.json",
    );
  });
});
