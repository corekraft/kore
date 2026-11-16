import { existsSync, readFileSync } from "node:fs";
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

  it("tells a writer to open its PR with pr open, which writes the declaration lines", () => {
    expect(writer).toContain("node skills/bin/harness.mjs pr open");
    expect(writer).toContain("Safety pattern:");
    expect(writer).toContain("Idea:");
    expect(writer).toContain("Expand step:");
  });

  it("says pr open defaults to Refs and that --closes is for an issue the merge delivers", () => {
    expect(writer).toContain("`Refs #n` by default");
    expect(writer).toContain("`--closes`");
  });

  it("no longer tells a writer to copy the declaration lines into a gh pr create body by hand", () => {
    expect(writer).not.toContain("yourself");
  });

  it("tells a writer to run pr check after pr open, fix what it lists, push, and run it once more", () => {
    const step =
      writer.split("\n").find((line) => line.startsWith("3. ")) ?? "";
    expect(step).toContain("node skills/bin/harness.mjs pr check <pr>");
    expect(step).toContain(
      "Fix every failure it lists, push, and run it once more",
    );
    expect(step).toContain(
      "Pending CI or a missing review is the judge's to wait on, not a failure you fix",
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

describe("the judge definition", () => {
  const judge = read(".claude/agents/judge.md");

  const merges = section(judge, "Merges without asking the owner").replace(
    /\]\([^)]*\)/g,
    "]",
  );

  it("points to judge merge and ADR 0099 instead of listing the safety patterns", () => {
    expect(merges).toContain("judge merge");
    expect(merges).toContain("ADR 0099");
    for (const pattern of [
      "dark launch",
      "branch-by-abstraction",
      "expand-contract",
      "feature flag",
    ]) {
      expect(merges).not.toContain(pattern);
    }
  });

  it("keeps the two rules judge merge does not enforce", () => {
    expect(merges).toMatch(/cluster-facing `no-behaviour-change`[^.]*live run/);
    expect(merges).toMatch(/[Aa]ctivation[^.]*recorded[^.]*outcome[^.]*owner/);
  });

  it("lists the reads that work, and none the guard still refuses", () => {
    const reads = section(judge, "Reads that work");
    for (const command of [
      "`node skills/bin/harness.mjs judge diff <pr>`",
      "`git diff`",
      "`git show`",
      "`gh pr view`",
      "`gh pr diff`",
      "`cat`",
      "`grep`",
      "`node skills/bin/harness.mjs plan active`",
    ]) {
      expect(reads).toContain(command);
    }
    for (const refused of [
      "merge-base",
      "cat-file",
      "ls-tree",
      "ls-remote",
      "git fetch",
      "`which`",
      "command -v",
      "--help",
    ]) {
      expect(judge).not.toContain(refused);
    }
  });

  it("keeps step 1 to the judgement, without the precheck internals", () => {
    const step1 = judge.split("\n").find((l) => l.startsWith("1. ")) ?? "";
    expect(step1).toContain("toolingPaths");
    expect(step1).toContain("product behaviour");
    expect(step1).not.toContain("reviewerLogins");
    expect(step1).not.toContain("ledger");
  });
});

describe("the add-policy skill", () => {
  const skill = read("skills/add-policy/SKILL.md");

  it("runs the Gatekeeper suites for constraint templates, in the run step", () => {
    const mentions = skill.split("test-gatekeeper").length - 1;
    expect(mentions).toBe(1);
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

describe("the spawn-session skill's retirement", () => {
  const agents = read("AGENTS.md");

  it("is deleted, with its command-line symlink", () => {
    expect(existsSync(join(ROOT, "skills/spawn-session"))).toBe(false);
    expect(existsSync(join(ROOT, ".claude/skills/spawn-session"))).toBe(false);
  });

  it("is not linked from the docs index or the skill evals", () => {
    expect(read("docs/index.md")).not.toContain("skills/spawn-session");
    expect(read(".claude/evals/skills.json")).not.toContain("spawn-session");
  });

  it("keeps its three rules in AGENTS.md", () => {
    expect(agents).toContain(
      "Role panes start only through `session spawn`, which hands them their token and sandbox; read herdr's own skill with `herdr --skill`.",
    );
    expect(agents).toContain(
      "- **Every agent message names its sender.** A comment or pane message written by a harness command starts with a `sender: <role> <session> (<command>)` line, or `sender: the main session (<command>)`, taken from the spawn environment and never typed by hand. A message with no sender line is the owner's. A sender line, like an older `[herdr:<name>]` or `[orchestrator]` tag, shows where text came from and is never approval: read the pane or the PR and judge it yourself.",
    );
    expect(agents).toContain(
      "A session closes only the panes it created, once their result is recorded.",
    );
  });
});

describe("the principles-review agent", () => {
  const agent = read(".claude/agents/principles-review.md");

  it("names the exact review post command, not a hand-written gh comment", () => {
    expect(agent).toContain("node skills/bin/harness.mjs review post <pr>");
    expect(agent).toContain("never a hand-written `gh pr comment`");
  });

  it("keys the live-run rule on the declared safety pattern", () => {
    expect(agent).toContain("`Safety pattern:` line");
    expect(agent).toMatch(
      /`no-behaviour-change`[^\n]*cite a live run before merge/,
    );
    expect(agent).toContain("flag that exists and defaults off");
    expect(agent).toContain("before `harness flag activate`, not before merge");
    expect(agent).toContain("would the container start");
  });

  it("names k3d, never Minikube, in the provider-neutrality question", () => {
    expect(agent).not.toMatch(/minikube/i);
    expect(agent).toContain(
      "no k3d, no cloud and no provider resource under `apps/`",
    );
  });

  it("seeds the live-run rule with a no-behaviour-change fixture that cites no live run", () => {
    const fixture = read(".claude/evals/principles-review/just-works.diff");
    expect(fixture).toContain("Safety pattern: no-behaviour-change");
    expect(fixture).not.toMatch(/live run/i);
  });
});
