import { beforeEach, describe, expect, it, vi } from "vitest";
import { DecisionError } from "./decision.js";
import { ADVISOR_FILES, matchedBy } from "./matcher.js";
import { reservedCategory } from "./reserved.js";
import {
  classify,
  routeQuestion,
  UNCLASSIFIED,
  type RoutePorts,
  type RouteInput,
} from "./route.js";

vi.mock("./matcher.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./matcher.js")>()),
  matchedBy: vi.fn(),
}));
vi.mock("./reserved.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./reserved.js")>()),
  reservedCategory: vi.fn(),
}));

const INPUT: RouteInput = {
  idea: "8",
  category: "naming",
  question: "Should the column be named Median or P50?",
  action: "Rename the column to Median.",
  escalate: false,
};

function ports(overrides: Partial<RoutePorts> = {}): RoutePorts {
  return {
    flagOn: vi.fn(() => Promise.resolve(true)),
    idea: vi.fn(() => Promise.resolve("0008")),
    record: vi.fn(() => Promise.resolve({ ok: true as const })),
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(matchedBy).mockReturnValue(undefined);
  vi.mocked(reservedCategory).mockReturnValue(undefined);
});

describe("classify", () => {
  it("routes a question to the advisor only when the declared category and the matcher both say so", () => {
    expect(classify(INPUT)).toEqual({ route: "advisor", signal: "agreed" });
  });

  it("routes a question to the owner when the matcher matches its text or its proposed action", () => {
    vi.mocked(matchedBy).mockReturnValue("destruction");

    expect(classify(INPUT)).toEqual({ route: "owner", signal: "matched" });
    expect(matchedBy).toHaveBeenCalledWith(
      "Should the column be named Median or P50?\nRename the column to Median.",
    );
  });

  it("routes a question that names the advisor's own files to the owner under advisor-files", () => {
    vi.mocked(matchedBy).mockReturnValue(ADVISOR_FILES);

    expect(classify(INPUT)).toEqual({
      route: "owner",
      signal: "advisor-files",
    });
  });

  it("routes a declared category that is a reserved name to the owner, even when the text matches nothing", () => {
    expect(classify({ ...INPUT, category: "credentials" })).toEqual({
      route: "owner",
      signal: "reserved-category",
    });
    expect(matchedBy).not.toHaveBeenCalled();
  });

  it("routes a declared category that a reserved pattern matches to the owner", () => {
    vi.mocked(reservedCategory).mockReturnValue("destruction");

    expect(classify({ ...INPUT, category: "delete-branch" })).toEqual({
      route: "owner",
      signal: "reserved-category",
    });
  });

  it("routes a category it cannot read, or a question or action with no text, to the owner as unclassifiable", () => {
    for (const bad of [
      { category: "" },
      { category: "Naming Rules" },
      { category: "a".repeat(65) },
      { question: "   " },
      { action: "" },
    ]) {
      expect(classify({ ...INPUT, ...bad })).toEqual({
        route: "owner",
        signal: "unclassifiable",
      });
    }
  });

  it("routes an escalated question to the owner whatever the signals say, so no input moves it to the advisor", () => {
    expect(classify({ ...INPUT, escalate: true })).toEqual({
      route: "owner",
      signal: "escalated",
    });
  });
});

describe("routeQuestion", () => {
  it("records decision.routed with the idea, the category, the route and the signal, and never the question or the action", async () => {
    const p = ports();

    const routed = await routeQuestion(p, INPUT);

    expect(p.record).toHaveBeenCalledWith({
      idea: "0008",
      label: "naming",
      route: "advisor",
      signal: "agreed",
    });
    expect(routed).toEqual({
      idea: "0008",
      category: "naming",
      route: "advisor",
      signal: "agreed",
    });
  });

  it("records an unreadable category under the unclassified label, so the ledger accepts the event and the owner gets it", async () => {
    const p = ports();

    const routed = await routeQuestion(p, { ...INPUT, category: "Bad Name" });

    expect(p.record).toHaveBeenCalledWith({
      idea: "0008",
      label: UNCLASSIFIED,
      route: "owner",
      signal: "unclassifiable",
    });
    expect(routed.category).toBe(UNCLASSIFIED);
  });

  it("records an escalation as route owner, the advisor's escalation writing no advisor route", async () => {
    const p = ports();

    const routed = await routeQuestion(p, { ...INPUT, escalate: true });

    expect(p.record).toHaveBeenCalledWith({
      idea: "0008",
      label: "naming",
      route: "owner",
      signal: "escalated",
    });
    expect(routed.route).toBe("owner");
  });

  it("refuses, recording nothing, while the decision-advisor flag is off", async () => {
    const p = ports({ flagOn: vi.fn(() => Promise.resolve(false)) });

    await expect(routeQuestion(p, INPUT)).rejects.toThrow(DecisionError);
    await expect(routeQuestion(p, INPUT)).rejects.toThrow(
      /decision-advisor flag is off/,
    );
    expect(p.record).not.toHaveBeenCalled();
    expect(p.idea).not.toHaveBeenCalled();
  });

  it("refuses an advisor route the ledger rejects, so the pane never acts on a route nobody recorded", async () => {
    const p = ports({
      record: vi.fn(() =>
        Promise.resolve({ ok: false as const, message: "label is empty." }),
      ),
    });

    await expect(routeQuestion(p, INPUT)).rejects.toThrow(
      /label is empty\. Treat the question as the owner's/,
    );
  });
});
