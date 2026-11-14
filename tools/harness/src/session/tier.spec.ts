import { describe, expect, it } from "vitest";
import { testHarness } from "../testing/index.js";
import { run } from "../cli/index.js";

const reader =
  "---\nname: reader\nmodel: claude-haiku-5-5\neffort: low\ntools: Read\n---\n";

describe("session tier", () => {
  it("prints the model and effort the role's definition declares, as JSON", async () => {
    const h = testHarness({
      files: { "/repo/.claude/agents/reader.md": reader },
    });
    expect(await run(["session", "tier", "reader", "--json"], h.deps)).toBe(0);
    expect(JSON.parse(h.out())).toEqual({
      role: "reader",
      model: "claude-haiku-5-5",
      effort: "low",
    });
    expect(h.runner.calls).toEqual([]);
  });

  it("prints a human line without --json", async () => {
    const h = testHarness({
      files: { "/repo/.claude/agents/reader.md": reader },
    });
    expect(await run(["session", "tier", "reader"], h.deps)).toBe(0);
    expect(h.out()).toBe("reader: claude-haiku-5-5, effort low\n");
  });

  it("refuses a role whose definition is missing or incomplete, naming the file to fix", async () => {
    const h = testHarness();
    expect(await run(["session", "tier", "ghost"], h.deps)).toBe(2);
    expect(h.err()).toContain(".claude/agents/ghost.md");
    expect(h.out()).toBe("");
  });

  it("requires a role", async () => {
    const h = testHarness();
    expect(await run(["session", "tier"], h.deps)).toBe(2);
    expect(h.err()).toContain("role");
  });
});
