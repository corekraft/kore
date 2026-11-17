// The judgment role's corpus is data: the spec keeps it from shrinking, going blank or losing a kind of attempt silently.

import { describe, expect, it } from "vitest";
import { JUDGMENT_ALLOWED, JUDGMENT_REFUSED } from "./guard-corpus-judgment.js";

const refusedCommands = JUDGMENT_REFUSED.filter((c) => c.tool === "Bash").map(
  (c) => c.input,
);

describe("judgment role corpus data", () => {
  it("names the judgment role on every case and the read-only rule on every refusal", () => {
    expect(JUDGMENT_REFUSED.filter((c) => c.role !== "judgment")).toEqual([]);
    expect(JUDGMENT_ALLOWED.filter((c) => c.role !== "judgment")).toEqual([]);
    expect(JUDGMENT_REFUSED.filter((c) => c.rule !== "role-read-only")).toEqual(
      [],
    );
  });

  it("refuses a git mutation, a gh mutation, a shell write and both file-writing tools", () => {
    for (const attempt of [
      "git commit",
      "git push",
      "git checkout",
      "gh pr merge",
      "gh pr create",
      "gh issue comment",
      "gh pr review",
      "session spawn",
      "flag activate",
      "outcome record",
      "tee ",
      "sed -i",
    ]) {
      expect(
        refusedCommands.some((c) => c.includes(attempt)),
        attempt,
      ).toBe(true);
    }
    expect(
      JUDGMENT_REFUSED.filter((c) => c.tool === "Write" || c.tool === "Edit")
        .length,
    ).toBeGreaterThan(0);
  });

  it("keeps the gh, git and harness reads the role needs, and the three read tools", () => {
    const commands = JUDGMENT_ALLOWED.filter((c) => c.tool === "Bash").map(
      (c) => c.input,
    );
    for (const read of [
      "gh pr view",
      "gh issue view",
      "git log",
      "plan active",
    ]) {
      expect(
        commands.some((c) => c.includes(read)),
        read,
      ).toBe(true);
    }
    expect(JUDGMENT_ALLOWED.map((c) => c.tool)).toEqual(
      expect.arrayContaining(["Read", "Grep", "Glob"]),
    );
  });

  it("holds no blank or repeated call, and no call is both allowed and refused", () => {
    const all = [
      ...JUDGMENT_REFUSED.map((c) => `${c.tool} ${c.input}`),
      ...JUDGMENT_ALLOWED.map((c) => `${c.tool} ${c.input}`),
    ];
    expect(all.filter((c) => c.trim() === "")).toEqual([]);
    expect(new Set(all).size).toBe(all.length);
  });
});
