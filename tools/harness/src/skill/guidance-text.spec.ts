import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../../../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const ADR_0097 =
  "0097-an-outcome-issue-closes-on-recorded-proof-not-on-merge.md";

/** The local-check rule the writer definition and the TDD skill both carry, pointing at AGENTS.md (Changes). */
const LOCAL_CHECKS_SENTENCE =
  "Locally run only the related tests and typecheck; the full suites run in CI `check` (AGENTS.md, Changes).";

/** The paragraph under a `## heading`, up to the next `## ` heading. */
function section(text: string, heading: string): string {
  const start = text.indexOf(`## ${heading}`);
  expect(start, `missing "## ${heading}"`).toBeGreaterThan(-1);
  const rest = text.slice(start + heading.length + 3);
  const next = rest.search(/\n## /);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("the pull request template", () => {
  const template = read(".github/pull_request_template.md");

  it("never tells an author to write Closes unconditionally", () => {
    const closes = template
      .split("\n")
      .filter((line) => line.includes("Closes #<number>"));
    for (const line of closes) {
      expect(line).toMatch(/\bonly (when|if)\b/);
    }
  });

  it("asks for Refs by default and cites ADR 0097 for when Closes applies", () => {
    expect(template).toContain("Refs #<number>");
    expect(template).toContain(ADR_0097);
  });

  it("keeps the Safety pattern and Idea lines the precheck parses", () => {
    expect(template).toContain("Safety pattern: <pattern>");
    expect(template).toContain("Idea: <number or slug>");
  });
});

describe("the writer definition", () => {
  const writer = read(".claude/agents/writer.md");

  it("names both declaration lines the precheck reads", () => {
    expect(writer).toContain("Safety pattern: <pattern>");
    expect(writer).toContain("Idea: <number or slug>");
  });

  it("warns that gh pr create --body does not apply the template", () => {
    expect(writer).toMatch(
      /`gh pr create --body`[^\n]*does not apply the template/,
    );
  });

  it("tells a worker to run only the related tests and typecheck locally, pointing at AGENTS.md", () => {
    expect(writer).toContain(LOCAL_CHECKS_SENTENCE);
  });
});

describe("the test-driven-development skill", () => {
  const skill = read("skills/test-driven-development/SKILL.md");

  it("tells a worker to run only the related tests and typecheck locally, pointing at AGENTS.md", () => {
    expect(skill).toContain(LOCAL_CHECKS_SENTENCE);
  });

  it("gives a guard role rule a spec for every role it names", () => {
    expect(skill).toContain(
      "A guard role rule gets a spec for every role it names.",
    );
  });
});

describe("the orchestrator definition", () => {
  const orchestrator = read(".claude/agents/orchestrator.md");
  // Link targets name ADRs by file, which contain pattern words; check prose only.
  const merges = section(
    orchestrator,
    "Merges without asking the owner",
  ).replace(/\]\([^)]*\)/g, "]");

  it("does not repeat the safety-pattern list", () => {
    for (const pattern of [
      "no-behaviour-change",
      "dark launch",
      "branch-by-abstraction",
      "expand-contract",
      "feature flag",
    ]) {
      expect(merges).not.toContain(pattern);
    }
  });

  it("points to the judge's rule in one sentence", () => {
    expect(merges.trim().split(/(?<=[.!?])\s+/)).toHaveLength(1);
    expect(merges).toContain("judge");
  });
});

describe("the judge definition", () => {
  const judge = read(".claude/agents/judge.md");

  it("holds the safety-pattern list", () => {
    const merges = section(judge, "Merges without asking the owner");
    for (const pattern of [
      "no-behaviour-change",
      "dark launch",
      "branch-by-abstraction",
      "expand-contract",
      "feature flag",
    ]) {
      expect(merges).toContain(pattern);
    }
  });
});

describe("the add-policy skill", () => {
  const skill = read("skills/add-policy/SKILL.md");

  it("runs the Gatekeeper suites for constraint templates, in the run step and the footer", () => {
    const mentions = skill.split("test-gatekeeper").length - 1;
    expect(mentions).toBeGreaterThanOrEqual(2);
    expect(skill).toContain("mise run test-gatekeeper");
  });
});

describe("the pin-upgrade skill", () => {
  const skill = read("skills/pin-upgrade/SKILL.md");

  it("says kore validate already refuses a non-exact tool pin", () => {
    expect(skill).toMatch(
      /`kore validate` already refuses a non-exact version in the tool catalog/,
    );
  });
});

describe("the spawn-session skill", () => {
  const skill = read("skills/spawn-session/SKILL.md");

  it("keeps the command line, the wait source of truth, and the ADR 0096 link", () => {
    expect(skill).toContain("session spawn --role <role>");
    expect(skill).toContain("`session wait <name>` is the source of truth");
    expect(skill).toContain(
      "0096-role-tokens-reach-panes-through-a-fifo-handoff.md",
    );
  });

  it("no longer restates the checks the spawn command performs itself", () => {
    expect(skill).not.toContain("It checks Herdr");
    expect(skill).not.toContain("tools/harness/wizards/identities.sh");
  });
});
