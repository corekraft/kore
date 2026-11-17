import { beforeEach, describe, expect, it, vi } from "vitest";
import { time } from "./github-waits.js";
import { guardBlocksByRule } from "./guard-blocks-by-rule.js";
import { inWindow, scopeOf, windowOf } from "./scope.js";
import { newLife } from "./toil.js";
import {
  SCOPE,
  WINDOW,
  cover,
  ev,
  fakeLife,
  fakeTally,
  run,
} from "./report-support.js";

vi.mock("./github-waits.js");
vi.mock("./guard-blocks-by-rule.js");
vi.mock("./scope.js");
vi.mock("./select.js");
vi.mock("./tally.js");
vi.mock("./toil.js");

beforeEach(() => {
  vi.mocked(scopeOf).mockReturnValue(SCOPE);
  vi.mocked(windowOf).mockReturnValue(WINDOW);
  vi.mocked(time).mockImplementation((e) => Number(e.id));
  vi.mocked(inWindow).mockReturnValue(true);
  vi.mocked(newLife).mockReturnValue(fakeLife());
  cover(new Map());
});

describe("buildReport guard blocks per rule (#984)", () => {
  it("reports guard blocks per rule over every named event, in the window", () => {
    fakeTally();
    const named = [ev(1, "guard.block", { label: "role-no-merge" })];
    cover(new Map(), named);
    const perRule = { "role-no-merge": 1 };
    vi.mocked(guardBlocksByRule).mockReturnValue(perRule);

    expect(run([]).guardBlocksByRule).toBe(perRule);
    expect(guardBlocksByRule).toHaveBeenCalledWith(named, WINDOW);
  });
});
