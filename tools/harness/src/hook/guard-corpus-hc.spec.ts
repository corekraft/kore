import { describe, expect, it } from "vitest";
import { HC_ORDINARY, HC_REFUSED } from "./guard-corpus-hc.js";

const NO_TERMINAL = ["reader", "principles-review", "judgment", "judge"];

describe("hc corpus data", () => {
  it.each(NO_TERMINAL)(
    "refuses a raw hc send and an HC_TERMINAL_ID prefix for %s, under role-read-only",
    (role) => {
      expect(HC_REFUSED).toContainEqual({
        role,
        tool: "Bash",
        input: "hc send t1 hi",
        rule: "role-read-only",
      });
      expect(HC_REFUSED).toContainEqual({
        role,
        tool: "Bash",
        input: "HC_TERMINAL_ID=t1 hc get t1",
        rule: "role-read-only",
      });
    },
  );

  it("refuses the judge every hc read, which its list does not name", () => {
    expect(HC_REFUSED).toContainEqual({
      role: "judge",
      tool: "Bash",
      input: "hc get t1",
      rule: "role-read-only",
    });
  });

  it("refuses a bare claude launch in hc's form for the person's session and the writer", () => {
    expect(HC_REFUSED).toContainEqual({
      tool: "Bash",
      input: "hc run --bg -- claude",
      rule: "bare-agent-start",
    });
    expect(HC_REFUSED).toContainEqual({
      role: "writer",
      tool: "Bash",
      input: "hc run --bg -- claude --agent writer brief",
      rule: "bare-agent-start",
    });
  });

  it("keeps the hc reads for the three read-only roles, and no hc write for any", () => {
    expect(HC_ORDINARY).toContainEqual({
      role: "reader",
      tool: "Bash",
      input: "hc get t1 --json",
    });
    expect(
      [...new Set(HC_ORDINARY.map((c) => c.role ?? ""))].sort((a, b) =>
        a.localeCompare(b),
      ),
    ).toEqual(["judgment", "principles-review", "reader"]);
    expect(HC_ORDINARY.some((c) => c.role === "judge")).toBe(false);
    expect(HC_ORDINARY.some((c) => c.input.startsWith("hc send"))).toBe(false);
  });
});
