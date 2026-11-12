import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDefinition } from "./agent-definition.js";
import { displayName } from "./models.js";

const ROOT = join(import.meta.dirname, "../../../..");
const adr = readFileSync(
  join(ROOT, "docs/decisions/0078-agent-roles-run-as-herdr-panes.md"),
  "utf8",
);

/** The ADR's role table: role -> the model family and effort it names (effort absent when the cell gives only a model). */
function tiers(): Map<string, { family: string; effort?: string }> {
  const rows = new Map<string, { family: string; effort?: string }>();
  for (const line of adr.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    const tier = /^(Haiku|Sonnet|Opus)(?:, (low|medium|high|max))?$/.exec(
      cells[2] ?? "",
    );
    if (cells[1] && tier?.[1]) {
      rows.set(cells[1].toLowerCase(), {
        family: tier[1],
        ...(tier[2] === undefined ? {} : { effort: tier[2] }),
      });
    }
  }
  return rows;
}

const definitions = (): Map<string, string> =>
  new Map(
    readdirSync(join(ROOT, ".claude/agents"))
      .filter((file) => file.endsWith(".md"))
      .map((file) => [
        file.slice(0, -3),
        readFileSync(join(ROOT, ".claude/agents", file), "utf8"),
      ]),
  );

describe("agent definitions match the ADR 0078 tier table", () => {
  it("reads the table's roles, so an unreadable table cannot pass the test vacuously", () => {
    expect([...tiers().keys()]).toEqual(
      expect.arrayContaining(["concierge", "reader", "writer", "judge"]),
    );
  });

  it.each(["concierge", "reader"])(
    "%s has a definition whose model and effort are the table's",
    (role) => {
      const markdown = definitions().get(role);
      expect(markdown, `.claude/agents/${role}.md must exist`).toBeDefined();
      const found = parseDefinition(markdown ?? "");
      const expected = tiers().get(role);
      expect(displayName(found.model ?? "")).toMatch(
        new RegExp(`^${expected?.family ?? "none"} `),
      );
      expect(found.effort).toBe(expected?.effort);
    },
  );

  it("any other definition that names a role in the table also matches it", () => {
    for (const [role, markdown] of definitions()) {
      const expected = tiers().get(role);
      if (expected === undefined) {
        continue;
      }
      const found = parseDefinition(markdown);
      expect(displayName(found.model ?? ""), role).toMatch(
        new RegExp(`^${expected.family} `),
      );
      if (expected.effort !== undefined) {
        expect(found.effort, role).toBe(expected.effort);
      }
    }
  });

  it("pins each bounded role's tools, so widening one is a reviewed change", () => {
    const tools = (role: string) =>
      parseDefinition(definitions().get(role) ?? "").tools;
    expect(tools("concierge")).toEqual(["Bash"]);
    expect(tools("reader")).toEqual(["Read", "Grep", "Glob", "Bash"]);
  });
});
