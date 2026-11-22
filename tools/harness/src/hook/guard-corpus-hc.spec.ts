import { describe, expect, it } from "vitest";
import {
  HC_AUDIT,
  HC_LAUNCH_AUDIT,
  HC_ORDINARY,
  HC_REFUSED,
} from "./guard-corpus-hc.js";

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

  it("refuses a claude launch in hc's form for the read-only roles under role-read-only, not under the launch rule", () => {
    expect(HC_REFUSED).toContainEqual({
      role: "reader",
      tool: "Bash",
      input: "hc run --bg -- claude --agent reader brief",
      rule: "role-read-only",
    });
    expect(HC_REFUSED.some((c) => c.rule === "bare-agent-start-hc")).toBe(
      false,
    );
  });

  it("audits a bare claude launch in hc's form, by name, by path and inside a shell script, under bare-agent-start-hc", () => {
    expect(HC_LAUNCH_AUDIT).toContainEqual({
      tool: "Bash",
      input: "hc run --bg -- claude",
      rule: "bare-agent-start-hc",
    });
    expect(HC_LAUNCH_AUDIT).toContainEqual({
      tool: "Bash",
      input: "hc run --bg -- /usr/local/bin/claude --agent x brief",
      rule: "bare-agent-start-hc",
    });
    expect(HC_LAUNCH_AUDIT).toContainEqual({
      tool: "Bash",
      input: 'hc run --bg -- sh -c "exec claude --agent x"',
      rule: "bare-agent-start-hc",
    });
    expect(HC_LAUNCH_AUDIT.every((c) => c.rule === "bare-agent-start-hc")).toBe(
      true,
    );
  });
});

describe("hc corpus data: the audit and the reads", () => {
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

  it("names the writer's raw hc writes as audit cases under role-hc-raw, and never as refused", () => {
    expect(HC_AUDIT).toContainEqual({
      role: "writer",
      tool: "Bash",
      input: "hc send t1 hi",
      rule: "role-hc-raw",
    });
    expect(
      HC_AUDIT.every((c) => c.role === "writer" && c.rule === "role-hc-raw"),
    ).toBe(true);
    expect(HC_REFUSED.some((c) => c.rule === "role-hc-raw")).toBe(false);
  });
});
