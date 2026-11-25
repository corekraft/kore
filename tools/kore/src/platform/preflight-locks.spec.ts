import { readFile } from "node:fs/promises";
import { beforeEach, expect, test, vi } from "vitest";
import { describeSigners, isReleaseLock } from "./release-lock.js";
import { reasonOf } from "./preflight-message.js";
import { lockProblems } from "./preflight-locks.js";

vi.mock("node:fs/promises");
vi.mock("./release-lock.js");
vi.mock("./preflight-message.js");

const releaseLock = JSON.stringify({
  version: 1,
  authorizedSigners: ["release"],
  entries: {},
});
const mainLock = JSON.stringify({
  version: 1,
  authorizedSigners: ["main"],
  entries: {},
});

/** Serves each lock path its text; an unknown path is missing, as the file system reports it. */
function files(texts: Record<string, string>) {
  vi.mocked(readFile).mockImplementation(async (path) => {
    const name = typeof path === "string" ? path : "";
    const text = texts[name];
    if (text === undefined) {
      throw Object.assign(new Error(`ENOENT: no such file ${name}`), {
        code: "ENOENT",
      });
    }
    return text;
  });
}

beforeEach(() => {
  vi.mocked(reasonOf).mockReturnValue("the reason");
  vi.mocked(isReleaseLock).mockImplementation(
    (lock) =>
      typeof lock === "object" &&
      lock !== null &&
      "authorizedSigners" in lock &&
      JSON.stringify(lock.authorizedSigners) === '["release"]',
  );
  vi.mocked(describeSigners).mockImplementation(() => "the main signer");
});

test("a release chart lock and a release image lock are no missing prerequisite", async () => {
  files({ "chart.json": releaseLock, "template.json": releaseLock });
  expect(
    await lockProblems({
      chartLock: "chart.json",
      templateLock: "template.json",
    }),
  ).toEqual([]);
});

test("a run that gives no chart lock is missing the release chart lock, and the fix names the file to pass", async () => {
  files({ "template.json": releaseLock });
  const problems = await lockProblems({
    chartLock: undefined,
    templateLock: "template.json",
  });
  expect(problems).toEqual([
    {
      name: "release chart lock",
      problem: "--platform-chart-lock is not given",
      fix: "pass the platform-charts.lock.json attached to the release",
    },
  ]);
});

test("a run that gives no template lock is missing the release image lock, and the fix names the file to pass", async () => {
  files({ "chart.json": releaseLock });
  const problems = await lockProblems({
    chartLock: "chart.json",
    templateLock: undefined,
  });
  expect(problems).toEqual([
    {
      name: "release image lock",
      problem: "--platform-template-lock is not given",
      fix: "pass the template-images.lock.json attached to the release",
    },
  ]);
});

test("a main chart lock is refused as a missing release chart lock, naming its signer and the file", async () => {
  files({ "main.json": mainLock, "template.json": releaseLock });
  const [problem] = await lockProblems({
    chartLock: "main.json",
    templateLock: "template.json",
  });
  expect(problem?.name).toBe("release chart lock");
  expect(problem?.problem).toContain("main.json");
  expect(problem?.problem).toContain("the main signer");
  expect(problem?.fix).toContain(
    "platform-charts.lock.json attached to the release",
  );
});

test("an unreadable lock is named as unreadable with its path and its reason, and does not throw", async () => {
  files({ "template.json": releaseLock });
  const problems = await lockProblems({
    chartLock: "missing.json",
    templateLock: "template.json",
  });
  expect(problems).toHaveLength(1);
  expect(problems[0]?.name).toBe("release chart lock");
  expect(problems[0]?.problem).toContain("missing.json is not readable");
  expect(problems[0]?.problem).toContain("the reason");
});

test("every missing lock is reported in one pass, so a run that lacks both names both", async () => {
  files({});
  const problems = await lockProblems({
    chartLock: undefined,
    templateLock: undefined,
  });
  expect(problems.map((problem) => problem.name)).toEqual([
    "release chart lock",
    "release image lock",
  ]);
});
