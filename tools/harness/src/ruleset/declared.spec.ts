import { describe, expect, it } from "vitest";
import type { Mode } from "../guardrail/index.js";
import {
  RulesetError,
  candidateName,
  parseDeclared,
  planCandidate,
  planMain,
  ruleName,
  stage,
  typesOf,
  type Json,
} from "./declared.js";

const DELETION = { type: "deletion" };
// The declared checks require check and scan; the live version requires check only.
const checks = (...contexts: string[]) => ({
  type: "required_status_checks",
  parameters: {
    required_status_checks: contexts.map((context) => ({
      context,
      integration_id: 15368,
    })),
  },
});
const CHECKS = checks("check", "scan");
const OLD = checks("check");
const declared: Json = {
  name: "main",
  target: "branch",
  conditions: { ref_name: { exclude: [], include: ["~DEFAULT_BRANCH"] } },
  rules: [DELETION, CHECKS],
  bypass_actors: [],
};
const everything = (): Mode => "enforce";
const audit = (type: string): Mode =>
  type === "required_status_checks" ? "audit" : "enforce";
const ruleset = (rules: Json[], change: Json = {}): Json => ({
  id: 7,
  enforcement: "active",
  ...declared,
  rules,
  ...change,
});
/** The live candidate ruleset, in evaluate unless told otherwise. */
const candidateOf = (id: number | undefined, rules: Json[]): Json => ({
  id,
  ...declared,
  name: "main-candidate",
  rules,
  enforcement: "evaluate",
});

describe("parseDeclared accepts only a ruleset object with a name and rules", () => {
  it("returns the body of a JSON object that has a name and a rules list", () => {
    const text = JSON.stringify({ name: "main", rules: [DELETION] });
    expect(parseDeclared(".github/rulesets/main.json", text)).toEqual({
      name: "main",
      rules: [DELETION],
    });
  });

  it.each([
    ["text that is not JSON", "not json"],
    ["a JSON array", "[]"],
    ["a JSON null", "null"],
    ["no name", '{"rules":[]}'],
    ["rules that are not a list", '{"name":"main","rules":{}}'],
  ])("refuses %s, naming the file to fix", (_n, text) => {
    expect(() => parseDeclared(".github/rulesets/main.json", text)).toThrow(
      new RulesetError(
        '.github/rulesets/main.json must be a JSON object with a "name" and a "rules" list. Fix the file, then rerun.',
      ),
    );
  });
});

describe("candidateName and ruleName give the names the guardrail inventory and GitHub use", () => {
  it("names the candidate of a target", () => {
    expect(candidateName("main")).toBe("main-candidate");
  });

  it("names the inventory rule for a ruleset rule type, with dashes for underscores", () => {
    expect(ruleName("main", "required_status_checks")).toBe(
      "main-ruleset-required-status-checks",
    );
  });

  it("lists the rule types of a rule list in order", () => {
    expect(typesOf([DELETION, CHECKS])).toEqual([
      "deletion",
      "required_status_checks",
    ]);
  });
});

describe("stage keeps the enforce rules that are live or observed, and stages the rest", () => {
  it("puts every enforce rule in main when GitHub has no main yet", () => {
    expect(stage(declared, everything, undefined, undefined)).toEqual({
      main: [DELETION, CHECKS],
      candidate: [],
      pending: [],
    });
  });

  it("keeps main's live version of a rule the declared file still covers", () => {
    const live = ruleset([DELETION, CHECKS]);
    const staged = stage(declared, everything, live, undefined);
    expect(staged.main).toEqual([DELETION, CHECKS]);
    expect(staged.candidate).toEqual([]);
  });

  it("holds a changed enforce rule in the candidate and keeps main's old version until it is observed", () => {
    const staged = stage(
      declared,
      everything,
      ruleset([DELETION, OLD]),
      undefined,
    );
    expect(staged).toEqual({
      main: [DELETION, OLD],
      candidate: [CHECKS],
      pending: ["required_status_checks"],
    });
  });

  it("moves a changed enforce rule into main once the candidate holds the declared version", () => {
    const candidate = ruleset([CHECKS], { name: "main-candidate" });
    const staged = stage(
      declared,
      everything,
      ruleset([DELETION, OLD]),
      candidate,
    );
    expect(staged).toEqual({
      main: [DELETION, CHECKS],
      candidate: [],
      pending: [],
    });
  });

  it("sends an audit rule to the candidate and never to main", () => {
    const staged = stage(declared, audit, ruleset([DELETION]), undefined);
    expect(staged).toEqual({
      main: [DELETION],
      candidate: [CHECKS],
      pending: [],
    });
  });
});

describe("planMain says what the main ruleset must become", () => {
  it("creates an active main with the staged rules when GitHub has none", () => {
    const staged = stage(declared, everything, undefined, undefined);
    expect(planMain(declared, staged, undefined)).toEqual({
      action: "create",
      enforcement: "active",
      added: ["deletion", "required_status_checks"],
      removed: [],
      changed: [],
      weakened: [],
      pending: [],
      body: { ...declared, rules: [DELETION, CHECKS], enforcement: "active" },
    });
  });

  it("does nothing when live main is active and already matches", () => {
    const live = ruleset([DELETION, CHECKS]);
    const staged = stage(declared, everything, live, undefined);
    expect(planMain(declared, staged, live)).toMatchObject({
      action: "none",
      id: 7,
      from: "active",
      added: [],
      removed: [],
      changed: [],
    });
  });

  it("updates main that was left in evaluate, even when no rule differs", () => {
    const live = ruleset([DELETION, CHECKS], { enforcement: "evaluate" });
    const staged = stage(declared, everything, live, undefined);
    expect(planMain(declared, staged, live)).toMatchObject({
      action: "update",
      from: "evaluate",
      changed: [],
    });
  });
});

describe("planMain lists what changes against live main", () => {
  it("lists the rule types live main has that the file no longer declares as removed", () => {
    const live = ruleset([DELETION, { type: "required_linear_history" }]);
    const staged = stage(declared, everything, live, undefined);
    expect(planMain(declared, staged, live)).toMatchObject({
      action: "update",
      added: [],
      removed: ["required_linear_history"],
    });
  });

  it("lists the rule types main gains once the candidate has shown them", () => {
    const live = ruleset([DELETION]);
    const candidate = ruleset([CHECKS], { name: "main-candidate" });
    const staged = stage(declared, everything, live, candidate);
    expect(planMain(declared, staged, live)).toMatchObject({
      action: "update",
      added: ["required_status_checks"],
      pending: [],
    });
  });

  it("lists the declared fields that differ from live, and the rules whose parameters differ", () => {
    const live = ruleset([DELETION, OLD], {
      conditions: { ref_name: { exclude: [], include: ["refs/heads/x"] } },
    });
    const staged = stage(declared, everything, live, undefined);
    expect(planMain(declared, staged, live)).toMatchObject({
      action: "update",
      changed: ["conditions"],
    });
  });

  it("carries the enforce rules still waiting in the candidate as pending", () => {
    const live = ruleset([DELETION, OLD]);
    const staged = stage(declared, everything, live, undefined);
    expect(planMain(declared, staged, live).pending).toEqual([
      "required_status_checks",
    ]);
  });

  it("refuses live main that GitHub returned without a numeric id", () => {
    const live = ruleset([DELETION, CHECKS], { id: "seven" });
    const staged = stage(declared, everything, live, undefined);
    expect(() => planMain(declared, staged, live)).toThrow(
      "GitHub returned the live ruleset main without a numeric id, so it cannot be updated. Check it in the repository settings, then rerun.",
    );
  });
});

describe("planCandidate says what the candidate must hold in evaluate", () => {
  it("creates nothing when no rule is staged and there is no candidate", () => {
    expect(planCandidate(declared, [], undefined)).toEqual({
      name: "main-candidate",
      action: "none",
      enforcement: "evaluate",
      rules: [],
      body: {
        ...declared,
        name: "main-candidate",
        rules: [],
        enforcement: "evaluate",
      },
    });
  });

  it("creates the candidate with the staged rules when there is none", () => {
    const plan = planCandidate(declared, [CHECKS], undefined);
    expect(plan).toMatchObject({
      action: "create",
      rules: ["required_status_checks"],
      body: {
        name: "main-candidate",
        rules: [CHECKS],
        enforcement: "evaluate",
      },
    });
    expect(plan).not.toHaveProperty("id");
  });

  it("does nothing when the live candidate already holds the same rules in evaluate", () => {
    const live = candidateOf(8, [CHECKS]);
    expect(planCandidate(declared, [CHECKS], live)).toMatchObject({
      action: "none",
      id: 8,
    });
  });

  it("updates a live candidate whose rule parameters differ", () => {
    const live = candidateOf(8, [OLD]);
    expect(planCandidate(declared, [CHECKS], live)).toMatchObject({
      action: "update",
      id: 8,
    });
  });

  it("refuses a live candidate without a numeric id", () => {
    const live = candidateOf(undefined, []);
    expect(() => planCandidate(declared, [CHECKS], live)).toThrow(
      "GitHub returned the live ruleset main-candidate without a numeric id, so it cannot be updated.",
    );
  });
});
