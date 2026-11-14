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
      expect.arrayContaining(["concierge", "reader", "writer", "judge"]),
    );
  });

  it.each([
    "concierge",
    "refiner",
    "challenger",
    "reader",
    "orchestrator",
    "writer",
    "judge",
  ])("%s has a definition whose model and effort are the table's", (role) => {
    const markdown = definitions().get(role);
    expect(markdown, `.claude/agents/${role}.md must exist`).toBeDefined();
    const found = parseDefinition(markdown ?? "");
    const expected = tiers().get(role);
    expect(displayName(found.model ?? "")).toMatch(
      new RegExp(`^${expected?.family ?? "none"} `),
    );
    expect(found.effort).toBe(expected?.effort);
  });

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
    for (const role of [
      "concierge",
      "refiner",
      "challenger",
      "reader",
      "orchestrator",
      "judge",
    ]) {
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
    expect(tools("concierge")).toEqual(["Bash"]);
    expect(tools("refiner")).toEqual(["Bash", "Glob", "Grep", "Read"]);
    expect(tools("challenger")).toEqual(["Bash", "Glob", "Grep", "Read"]);
    expect(tools("reader")).toEqual(["Read", "Grep", "Glob", "Bash"]);
    expect(tools("orchestrator")).toEqual(["Bash", "Glob", "Grep", "Read"]);
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

describe("the refiner and challenger definitions", () => {
  const body = (role: string) => definitions().get(role) ?? "";

  it("declare their tiers: Sonnet at medium and Opus at high", () => {
    const refiner = parseDefinition(body("refiner"));
    const challenger = parseDefinition(body("challenger"));
    expect(displayName(refiner.model ?? "")).toMatch(/^Sonnet /);
    expect(refiner.effort).toBe("medium");
    expect(displayName(challenger.model ?? "")).toMatch(/^Opus /);
    expect(challenger.effort).toBe("high");
  });

  it("forbid the challenger from reviewing code and send that to the judge", () => {
    expect(body("challenger")).toMatch(/never review code/);
    expect(body("challenger")).toMatch(/judge/);
  });

  it("have the same challenger review ideas, ADRs and plans, with no second definition", () => {
    expect(body("challenger")).toMatch(/An idea/);
    expect(body("challenger")).toMatch(/An ADR or a plan/);
    const challengers = [...definitions().keys()].filter((role) =>
      /challeng|adr|plan/.test(role),
    );
    expect(challengers).toEqual(["challenger"]);
  });

  it("have the refiner file ideas only through the idea tool, with every field the idea needs", () => {
    for (const field of [
      "--hypothesis",
      "--expected-outcome",
      "--measurement",
      "--safety-pattern",
    ]) {
      expect(body("refiner")).toContain(field);
    }
  });

  it("route a raw request from the concierge to the refiner", () => {
    expect(body("concierge")).toMatch(/raw request goes to the refiner/);
  });
});

describe("the judge and orchestrator state which safety patterns merge without the owner", () => {
  const body = (role: string) => definitions().get(role) ?? "";

  it.each(["judge", "orchestrator"])(
    "%s lets a frictionless pattern merge without asking the owner",
    (role) => {
      expect(body(role)).toMatch(/without asking the owner/);
      expect(body(role)).toMatch(/no-behaviour-change/);
      expect(body(role)).toMatch(/dark launch/);
      expect(body(role)).toMatch(/expand-contract/);
      expect(body(role)).toMatch(/feature flag/);
    },
  );

  it.each(["judge", "orchestrator"])(
    "%s keeps a cluster-facing no-behaviour-change behind its live run",
    (role) => {
      expect(body(role)).toMatch(/cluster-facing[\s\S]*live run/);
    },
  );

  it.each(["judge", "orchestrator"])(
    "%s sends activation to the owner after a recorded experiment outcome",
    (role) => {
      expect(body(role)).toMatch(/activat\w*[\s\S]*experiment outcome/);
    },
  );

  it.each(["judge", "orchestrator"])(
    "%s links the decisions the rule restates instead of copying them",
    (role) => {
      expect(body(role)).toMatch(/\(\.\.\/\.\.\/docs\/decisions\/0099-/);
      expect(body(role)).toMatch(/\(\.\.\/\.\.\/docs\/decisions\/0077-/);
    },
  );

  it("never gives the orchestrator merge rights, so it still sends merges to the judge", () => {
    expect(body("orchestrator")).toMatch(/you do not merge/);
    expect(body("orchestrator")).not.toMatch(/squash/);
  });
});
