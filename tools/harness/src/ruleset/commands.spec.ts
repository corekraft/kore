import { beforeEach, describe, expect, it, vi } from "vitest";
import { candidateName } from "./declared.js";
import { rulesetCommands } from "./commands.js";
import { GitHubRulesets } from "./github.js";
import { summarize, type Insights } from "./insights.js";
import { syncRuleset } from "./sync.js";
import { destination, guarded } from "./support.js";
import {
  REPO,
  asGitHub,
  fakeContext,
  fakeDeps,
  fakeGitHub,
  type FakeDeps,
  type FakeGitHub,
} from "./ruleset-support.js";

vi.mock("./sync.js");
vi.mock("./insights.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./insights.js")>()),
  summarize: vi.fn(),
}));
vi.mock("./github.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./github.js")>()),
  GitHubRulesets: vi.fn(),
}));
vi.mock("./declared.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./declared.js")>()),
  candidateName: vi.fn(),
}));
vi.mock("./support.js");

const insights = rulesetCommands["insights"];
const sync = rulesetCommands["sync"];
if (insights === undefined || sync === undefined) {
  throw new Error("the ruleset command table must hold sync and insights");
}

const result = (overrides: Partial<Insights> = {}): Insights => ({
  repo: REPO,
  target: "main",
  ruleset: "main-candidate",
  timePeriod: "week",
  suites: 3,
  firings: 2,
  byRule: { required_status_checks: 2 },
  actors: ["junners"],
  truncated: false,
  ...overrides,
});

let deps: FakeDeps;
let github: FakeGitHub;

beforeEach(() => {
  deps = fakeDeps();
  github = fakeGitHub();
  vi.mocked(guarded).mockImplementation((_context, action) => action());
  vi.mocked(destination).mockReturnValue({ repo: REPO, target: "main" });
  vi.mocked(candidateName).mockReturnValue("main-candidate");
  vi.mocked(GitHubRulesets).mockImplementation(function () {
    return asGitHub(github);
  });
  github.find.mockResolvedValue({ id: 8 });
  vi.mocked(summarize).mockResolvedValue(result());
});

describe("the ruleset command table declares sync and insights and their flags", () => {
  it("names exactly the two commands, sync and insights", () => {
    expect(Object.keys(rulesetCommands)).toEqual(["sync", "insights"]);
  });

  it("declares the sync flags the operator passes", () => {
    expect(sync.options).toEqual({
      repo: "string",
      target: "string",
      "dry-run": "boolean",
      confirm: "boolean",
      "allow-removal": "boolean",
    });
  });

  it("declares the insights flags", () => {
    expect(insights.options).toEqual({
      repo: "string",
      target: "string",
      "time-period": "string",
    });
  });
});

describe("sync runs the sync unit through the expected-error guard", () => {
  it("passes the context to the guard and returns the sync's exit code", async () => {
    vi.mocked(syncRuleset).mockResolvedValue(0);
    const context = fakeContext({ repo: REPO, target: "main" }, deps);
    expect(await sync.run(context)).toBe(0);
    expect(guarded).toHaveBeenCalledWith(context, expect.any(Function));
    expect(syncRuleset).toHaveBeenCalledWith(context);
  });
});

describe("insights reads the candidate ruleset and prints its summary", () => {
  it("prints the summary as one json object when the context asks for json", async () => {
    const context = fakeContext({ repo: REPO, target: "main" }, deps, true);
    expect(await insights.run(context)).toBe(0);
    expect(deps.stdout.mock.calls).toEqual([[`${JSON.stringify(result())}\n`]]);
  });

  it("prints a readable summary: the header, one row per rule, and the actors", async () => {
    const context = fakeContext({ repo: REPO, target: "main" }, deps);
    expect(await insights.run(context)).toBe(0);
    expect(deps.stdout.mock.calls).toEqual([
      [
        "Ruleset main in corekraft/kore, last week: 2 evaluate firings in 3 rule suites.\n  required_status_checks\t2\nActors: junners\n",
      ],
    ]);
  });

  it("names a truncated period and leaves the actors line out when none fired", async () => {
    vi.mocked(summarize).mockResolvedValue(
      result({ firings: 0, byRule: {}, actors: [], truncated: true }),
    );
    await insights.run(fakeContext({ repo: REPO, target: "main" }, deps));
    expect(deps.stdout.mock.calls).toEqual([
      [
        "Ruleset main in corekraft/kore, last week: 0 evaluate firings in 3 rule suites.\nTruncated: more suites exist than one page; narrow --time-period.\n",
      ],
    ]);
  });

  it("summarizes the candidate ruleset, with the live candidate's id and the chosen period", async () => {
    await insights.run(
      fakeContext({ repo: REPO, target: "main", "time-period": "day" }, deps),
    );
    expect(GitHubRulesets).toHaveBeenCalledWith(deps.runner, REPO);
    expect(github.find.mock.calls).toEqual([["main-candidate"]]);
    expect(summarize).toHaveBeenCalledWith(asGitHub(github), {
      repo: REPO,
      target: "main",
      ruleset: "main-candidate",
      targetId: 8,
      timePeriod: "day",
    });
  });

  it("leaves the target id out when GitHub has no live candidate", async () => {
    github.find.mockResolvedValue(undefined);
    await insights.run(fakeContext({ repo: REPO, target: "main" }, deps));
    expect(vi.mocked(summarize).mock.calls[0]?.[1].targetId).toBeUndefined();
  });

  it("refuses a period that is not one of the four, and summarizes nothing", async () => {
    const context = fakeContext(
      { repo: REPO, target: "main", "time-period": "year" },
      deps,
    );
    await expect(insights.run(context)).rejects.toThrow(
      "--time-period year is not one of hour, day, week, month. Rerun with --time-period <hour|day|week|month>.",
    );
    expect(summarize).not.toHaveBeenCalled();
  });
});
