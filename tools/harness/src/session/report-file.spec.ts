import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandError, type Links } from "../runtime/index.js";
import { fakeFileSystem } from "./deps-support.js";
import {
  isInsideReportDir,
  noticeLine,
  readReport,
  reportDirOf,
  reportPath,
} from "./report-file.js";

const WORK = "/work/writer";
const REPORT_DIR = "/work/writer/.kore/report";
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
    expect(reportDirOf(WORK)).toBe(REPORT_DIR);
  });
});

describe("isInsideReportDir refuses a path outside the report directory, as its real location", () => {
  const links = { realpath: vi.fn<Links["realpath"]>() };

  beforeEach(() => {
    links.realpath.mockImplementation((path: string) => Promise.resolve(path));
  });

  it.each([
    [
      "a sibling directory that shares its prefix",
      "/work/writer/.kore/report-old/x.md",
    ],
    [
      "a path that climbs out of it",
      "/work/writer/.kore/report/../../secret.md",
    ],
    ["the report directory itself", REPORT_DIR],
    ["a file beside the report directory", "/work/writer/.kore/summary.md"],
  ])("refuses %s without touching the disk", async (_label, path) => {
    const fs = fakeFileSystem();

    expect(await isInsideReportDir(fs, links, WORK, path)).toBe(false);
    expect(fs.exists).not.toHaveBeenCalled();
    expect(links.realpath).not.toHaveBeenCalled();
  });

  it("accepts a file in the report directory that does not exist yet, since there is nothing to read", async () => {
    const fs = fakeFileSystem();
    fs.exists.mockResolvedValue(false);

    expect(
      await isInsideReportDir(fs, links, WORK, `${REPORT_DIR}/summary.md`),
    ).toBe(true);
    expect(links.realpath).not.toHaveBeenCalled();
  });

  it("refuses an existing file when no link resolver is injected, so containment is not proven", async () => {
    const fs = fakeFileSystem();
    fs.exists.mockResolvedValue(true);

    expect(
      await isInsideReportDir(fs, undefined, WORK, `${REPORT_DIR}/summary.md`),
    ).toBe(false);
  });
});

describe("isInsideReportDir follows links, so a link cannot reach outside", () => {
  const links = { realpath: vi.fn<Links["realpath"]>() };

  beforeEach(() => {
    links.realpath.mockImplementation((path: string) => Promise.resolve(path));
  });

  it("accepts a real file in the report directory", async () => {
    const fs = fakeFileSystem();
    fs.exists.mockResolvedValue(true);

    expect(
      await isInsideReportDir(fs, links, WORK, `${REPORT_DIR}/summary.md`),
    ).toBe(true);
  });

  it("refuses a link inside the report directory that resolves to a file outside it", async () => {
    const fs = fakeFileSystem();
    fs.exists.mockResolvedValue(true);
    links.realpath.mockImplementation((path: string) =>
      Promise.resolve(path === REPORT_DIR ? REPORT_DIR : "/etc/passwd"),
    );

    expect(
      await isInsideReportDir(fs, links, WORK, `${REPORT_DIR}/leak.md`),
    ).toBe(false);
  });

  it("refuses a link that resolves into a sibling of the real report directory", async () => {
    const fs = fakeFileSystem();
    fs.exists.mockResolvedValue(true);
    links.realpath.mockImplementation((path: string) =>
      Promise.resolve(
        path === REPORT_DIR ? "/real/report" : "/real/report-old/x.md",
      ),
    );

    expect(await isInsideReportDir(fs, links, WORK, `${REPORT_DIR}/x.md`)).toBe(
      false,
    );
  });

  it("accepts a report directory that is itself a link, when the file resolves inside its real location", async () => {
    const fs = fakeFileSystem();
    fs.exists.mockResolvedValue(true);
    links.realpath.mockImplementation((path: string) =>
      Promise.resolve(
        path === REPORT_DIR ? "/real/report" : "/real/report/summary.md",
      ),
    );

    expect(
      await isInsideReportDir(fs, links, WORK, `${REPORT_DIR}/summary.md`),
    ).toBe(true);
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
