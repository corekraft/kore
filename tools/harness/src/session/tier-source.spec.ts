import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mainRoot } from "../runtime/index.js";
import { fakeDeps, type FakeDeps } from "./deps-support.js";
import { tierInputError, tierOf, tierSourceOf } from "./tier-source.js";

vi.mock("node:path");
const ledger = vi.hoisted(() => ({
  list: vi.fn<(filter: object) => Promise<{ events: object[] }>>(),
}));
vi.mock("../ledger/index.js", () => ({
  DEFAULT_LEDGER: ".kore/state/ledger.jsonl",
  Ledger: class {
    list(filter: object) {
      return ledger.list(filter);
    }
  },
}));
vi.mock("../runtime/index.js", () => ({ mainRoot: vi.fn() }));

const ESCALATION = {
  kind: "escalation",
  number: 612,
  label: "claude-opus-5-5",
};

let deps: FakeDeps;

beforeEach(() => {
  deps = fakeDeps();
  vi.mocked(join).mockImplementation((...parts: string[]) => parts.join("/"));
  vi.mocked(mainRoot).mockResolvedValue("/main");
  ledger.list.mockReset();
  ledger.list.mockResolvedValue({ events: [] });
});

describe("tierSourceOf", () => {
  it("records definition when no model or effort flag was given, without reading the ledger", async () => {
    await expect(tierSourceOf(deps, {})).resolves.toEqual({
      tierSource: "definition",
    });
    expect(ledger.list).not.toHaveBeenCalled();
  });

  it("records escalation when queue escalate recorded one for that PR on the same model", async () => {
    ledger.list.mockResolvedValue({ events: [ESCALATION] });

    await expect(
      tierSourceOf(deps, { model: "claude-opus-5-5", pr: 612 }),
    ).resolves.toEqual({ tierSource: "escalation" });
    expect(ledger.list).toHaveBeenCalledWith({ kind: "escalation" });
  });

  it("still records escalation when the PR head changed between the escalation and the relaunch", async () => {
    // A send-back at a newer head is another event kind; the escalation is keyed by PR alone.
    ledger.list.mockResolvedValue({
      events: [
        { kind: "send-back", number: 612, label: "tests @aaaaaaa" },
        ESCALATION,
        { kind: "send-back", number: 612, label: "lint @bbbbbbb" },
      ],
    });

    await expect(
      tierSourceOf(deps, { model: "claude-opus-5-5", pr: 612 }),
    ).resolves.toEqual({ tierSource: "escalation" });
  });

  it("records override with its reason when no escalation was recorded for that PR", async () => {
    ledger.list.mockResolvedValue({ events: [{ ...ESCALATION, number: 99 }] });

    await expect(
      tierSourceOf(deps, {
        model: "claude-opus-5-5",
        pr: 612,
        reason: "deep diff",
      }),
    ).resolves.toEqual({ tierSource: "override", tierReason: "deep diff" });
  });

  it("records override when the model differs from the one the escalation chose", async () => {
    ledger.list.mockResolvedValue({ events: [ESCALATION] });

    await expect(
      tierSourceOf(deps, { model: "claude-haiku-5", pr: 612 }),
    ).resolves.toEqual({ tierSource: "override" });
  });

  it("records a bare override without refusing it when no reason was given and no PR named", async () => {
    await expect(tierSourceOf(deps, { effort: "max" })).resolves.toEqual({
      tierSource: "override",
    });
    expect(ledger.list).not.toHaveBeenCalled();
  });

  it("records override when the ledger file is unreadable, which is a file-system fault", async () => {
    ledger.list.mockRejectedValue(
      Object.assign(new Error("denied"), { code: "EACCES" }),
    );

    await expect(
      tierSourceOf(deps, { model: "claude-opus-5-5", pr: 612 }),
    ).resolves.toEqual({ tierSource: "override" });
  });

  it("rethrows a fault that is not a file-system one, so a bug is never recorded as an override", async () => {
    ledger.list.mockRejectedValue(new TypeError("bug"));

    await expect(
      tierSourceOf(deps, { model: "claude-opus-5-5", pr: 612 }),
    ).rejects.toThrow("bug");
  });

  it("records override when there is no main checkout to hold a ledger", async () => {
    vi.mocked(mainRoot).mockResolvedValue(undefined);

    await expect(
      tierSourceOf(deps, { model: "claude-opus-5-5", pr: 612 }),
    ).resolves.toEqual({ tierSource: "override" });
  });
});

describe("tierInputError", () => {
  it("accepts no flags, a pull request number and a short reason", () => {
    expect(tierInputError({})).toBeUndefined();
    expect(tierInputError({ pr: "612", reason: "deep diff" })).toBeUndefined();
  });

  it.each(["abc", "0", "-3", "6.5", true])(
    "refuses --pr %s as not a pull request number",
    (pr) => {
      expect(tierInputError({ pr })).toBe(
        `Invalid --pr "${String(pr)}". Use a pull request number such as 612.`,
      );
    },
  );

  it.each(["", "x".repeat(101), "two\nlines", true])(
    "refuses a reason the ledger would drop, so it is never recorded as nothing",
    (reason) => {
      expect(tierInputError({ reason })).toBe(
        "Invalid --reason. Use 1 to 100 characters with no control characters.",
      );
    },
  );
});

describe("tierOf", () => {
  it("reads the flags spawn was given, with the PR as a number", async () => {
    ledger.list.mockResolvedValue({ events: [ESCALATION] });

    await expect(
      tierOf(deps, { model: "claude-opus-5-5", pr: "612", role: "writer" }),
    ).resolves.toEqual({ tierSource: "escalation" });
  });

  it("records definition when spawn was given no tier flag", async () => {
    await expect(tierOf(deps, { role: "judge" })).resolves.toEqual({
      tierSource: "definition",
    });
  });

  it("carries the reason into an override", async () => {
    await expect(
      tierOf(deps, { effort: "max", reason: "deep diff" }),
    ).resolves.toEqual({ tierSource: "override", tierReason: "deep diff" });
  });
});
