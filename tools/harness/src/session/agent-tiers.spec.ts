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
  // A refinement row ("- Writer: Haiku, medium.") overrides the table's tier.
  for (const line of adr.split("\n")) {
    const row = /^- (\w+): (Haiku|Sonnet|Opus), (low|medium|high|max)\.$/.exec(
      line,
    );
    if (row?.[1] && row[2]) {
      rows.set(row[1].toLowerCase(), { family: row[2], effort: row[3] ?? "" });
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
      expect.arrayContaining(["reader", "writer", "judge"]),
    );
  });

  it.each(["reader", "writer", "judge"])(
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
});

describe("agent definitions bound each role's tools", () => {
  it("only the writer may edit files", () => {
    for (const role of ["reader", "judge"]) {
      const tools = parseDefinition(definitions().get(role) ?? "").tools ?? [];
      expect(
        tools.filter((t) => /^(Edit|Write|NotebookEdit)$/.test(t)),
        role,
      ).toEqual([]);
    }
  });

  it("pins each bounded role's tools, so widening one is a reviewed change", () => {
    const tools = (role: string) =>
      parseDefinition(definitions().get(role) ?? "").tools;
    expect(tools("reader")).toEqual(["Read", "Grep", "Glob", "Bash"]);
    expect(tools("judge")).toEqual(["Bash", "Glob", "Grep", "Read"]);
    expect(tools("writer")).toEqual([
      "Bash",
      "Edit",
      "Glob",
      "Grep",
      "Read",
      "Skill",
      "Write",
    ]);
  });
});

describe("every agent definition runs on Haiku or Sonnet", () => {
  it("lists the definitions, so an empty folder cannot pass vacuously", () => {
    expect([...definitions().keys()].sort()).toEqual([
      "judge",
      "principles-review",
      "reader",
      "writer",
    ]);
  });

  it.each([...definitions()])(
    "%s declares a Haiku or Sonnet model",
    (role, markdown) => {
      const { model } = parseDefinition(markdown);
      expect(
        model,
        `.claude/agents/${role}.md must declare a model`,
      ).toBeDefined();
      expect(displayName(model ?? "")).toMatch(/^(Haiku|Sonnet) /);
    },
  );
});

describe("no agent fills a role the loop retired", () => {
  it("has no definition for the refiner or the challenger, which no session launches", () => {
    expect([...definitions().keys()]).not.toContain("refiner");
    expect([...definitions().keys()]).not.toContain("challenger");
  });
});

describe("no agent fills the orchestrator or concierge role", () => {
  it("has no definition for either, since `orchestrate run` and the person's main session do that work", () => {
    expect([...definitions().keys()]).not.toContain("orchestrator");
    expect([...definitions().keys()]).not.toContain("concierge");
  });
});

describe("the judge states which safety patterns merge without the owner", () => {
  const body = (role: string) => definitions().get(role) ?? "";

  it.each(["judge"])(
    "%s keeps a cluster-facing no-behaviour-change behind its live run",
    (role) => {
      expect(body(role)).toMatch(/cluster-facing[\s\S]*live run/);
    },
  );

  it("judge links ADR 0099 instead of copying the rule", () => {
    expect(body("judge")).toMatch(/\(\.\.\/\.\.\/docs\/decisions\/0099-/);
  });
});
