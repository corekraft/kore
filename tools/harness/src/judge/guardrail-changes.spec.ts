// Which inventory changes of a PR need an activation: the inventory parser is mocked and
// the two file sides come from a fake gh api.
// Docs: infra/plans/12-self-improving-loop.md#step-4-guardrail-activation-gate
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GuardrailError,
  parseInventory,
  type Guardrail,
} from "../guardrail/index.js";
import type { ChangedFile } from "./diff.js";
import { JudgeError } from "./errors.js";
import {
  gatherGuardrailChanges,
  guardrailChanges,
} from "./guardrail-changes.js";

vi.mock("../guardrail/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../guardrail/index.js")>()),
  parseInventory: vi.fn(),
}));

const rule = (name: string, mode: "audit" | "enforce"): Guardrail => ({
  rule: name,
  kind: "bash",
  mode,
  owner: "o",
});
const sides = (before: Guardrail[], after: Guardrail[]) =>
  vi
    .mocked(parseInventory)
    .mockImplementation((text) =>
      text === "BEFORE" ? { guardrails: before } : { guardrails: after },
    );

describe("guardrailChanges", () => {
  it("names a rule that moved from audit to enforce", () => {
    sides([rule("a", "audit")], [rule("a", "enforce")]);
    expect(guardrailChanges("BEFORE", "AFTER")).toEqual(["a:audit>enforce"]);
  });

  it("names a new rule that starts in enforce, and ignores one that starts in audit", () => {
    sides([], [rule("fresh", "enforce"), rule("calm", "audit")]);
    expect(guardrailChanges("BEFORE", "AFTER")).toEqual(["fresh:new>enforce"]);
  });

  it("names a rule that was loosened and a rule that was removed, with the mode it had", () => {
    sides(
      [rule("a", "enforce"), rule("b", "audit"), rule("c", "enforce")],
      [rule("a", "audit"), rule("c", "enforce")],
    );
    expect(guardrailChanges("BEFORE", "AFTER")).toEqual([
      "a:enforce>audit",
      "b:audit>removed",
    ]);
  });

  it("names nothing when no mode changed", () => {
    sides([rule("a", "enforce")], [rule("a", "enforce")]);
    expect(guardrailChanges("BEFORE", "AFTER")).toEqual([]);
  });

  it("refuses an inventory it cannot read, naming the side and the fix", () => {
    vi.mocked(parseInventory).mockImplementation(() => {
      throw new GuardrailError("bad json");
    });
    expect(() => guardrailChanges("BEFORE", "AFTER")).toThrow(
      new JudgeError(
        "The base guardrail inventory cannot be read: bad json Fix .claude/guardrails.yaml in the PR, then rerun.",
      ),
    );
  });
});

describe("gatherGuardrailChanges", () => {
  const touched: ChangedFile[] = [
    { path: ".claude/guardrails.yaml" } as ChangedFile,
  ];
  const api = vi.fn<(args: readonly string[]) => Promise<string>>();

  beforeEach(() => {
    api.mockReset();
    sides([rule("a", "audit")], [rule("a", "enforce")]);
  });

  it("reports nothing, and reads nothing, when the diff leaves the inventory alone", async () => {
    const other = [{ path: "src/a.ts" } as ChangedFile];
    expect(await gatherGuardrailChanges(other, api, "o/r", "b", "h")).toBe(
      undefined,
    );
    expect(api).not.toHaveBeenCalled();
  });

  it("reads the inventory at the merge base and at the head, and compares them", async () => {
    const answers: Record<string, string> = {
      "repos/o/r/compare/b...h": "mergebase\n",
      "repos/o/r/contents/.claude/guardrails.yaml?ref=mergebase": "BEFORE",
      "repos/o/r/contents/.claude/guardrails.yaml?ref=h": "AFTER",
    };
    api.mockImplementation((args) =>
      Promise.resolve(
        answers[args[args.length - (args[2] === "--jq" ? 3 : 1)] ?? ""] ?? "",
      ),
    );
    expect(await gatherGuardrailChanges(touched, api, "o/r", "b", "h")).toEqual(
      ["a:audit>enforce"],
    );
    expect(api.mock.calls.map(([args]) => args)).toEqual([
      ["api", "repos/o/r/compare/b...h", "--jq", ".merge_base_commit.sha"],
      [
        "api",
        "-H",
        "Accept: application/vnd.github.raw",
        "repos/o/r/contents/.claude/guardrails.yaml?ref=mergebase",
      ],
      [
        "api",
        "-H",
        "Accept: application/vnd.github.raw",
        "repos/o/r/contents/.claude/guardrails.yaml?ref=h",
      ],
    ]);
  });

  it("does not read a deleted inventory", async () => {
    const gone = [
      { path: ".claude/guardrails.yaml", deleted: true } as ChangedFile,
    ];
    expect(await gatherGuardrailChanges(gone, api, "o/r", "b", "h")).toBe(
      undefined,
    );
  });

  it("lets a failed gh read through, so a missing inventory is never read as no change", async () => {
    api.mockRejectedValue(new JudgeError("gh failed"));
    await expect(
      gatherGuardrailChanges(touched, api, "o/r", "b", "h"),
    ).rejects.toThrow("gh failed");
  });
});
