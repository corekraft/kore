import { describe, expect, it } from "vitest";
import {
  IdeaError,
  SAFETY_PATTERNS,
  outcomeSection,
  parseIdea,
  renderIdea,
  scalar,
  withIssue,
  withOutcome,
  withoutOutcome,
} from "./record.js";

const PATH = "docs/ideas/0001-cache-the-probe-results.md";

const FRONTMATTER = [
  "---",
  "summary: Cache the probe results",
  "hypothesis: Caching probes cuts up time.",
  "expected-outcome: Up time drops by 20 percent.",
  "measurement: Compare kore local up duration in the ledger.",
  "safety-pattern: feature-flagged",
  "date: 2026-03-04",
  "---",
  "",
  "# Idea 0001: Cache the probe results",
  "",
].join("\n");

describe("the safety patterns", () => {
  it("are exactly the five patterns an idea may name", () => {
    expect([...SAFETY_PATTERNS]).toEqual([
      "no-behaviour-change",
      "feature-flagged",
      "dark-launched",
      "branch-by-abstraction",
      "expand-contract",
    ]);
  });

  it("IdeaError is an Error so callers can tell it from a crash", () => {
    const error = new IdeaError("boom");
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("boom");
  });
});

describe("parseIdea", () => {
  it("reads the number, slug, fields and the heading as the title", () => {
    expect(parseIdea(PATH, FRONTMATTER)).toEqual({
      number: "0001",
      slug: "cache-the-probe-results",
      path: PATH,
      title: "Cache the probe results",
      summary: "Cache the probe results",
      hypothesis: "Caching probes cuts up time.",
      expectedOutcome: "Up time drops by 20 percent.",
      measurement: "Compare kore local up duration in the ledger.",
      safetyPattern: "feature-flagged",
      date: "2026-03-04",
    });
  });

  it("takes the title from the summary when the file has no heading", () => {
    const text = FRONTMATTER.replace(
      "# Idea 0001: Cache the probe results",
      "",
    );
    expect(parseIdea(PATH, text).title).toBe("Cache the probe results");
  });

  it("keeps outcome, issue and parent only when they are set", () => {
    const text = FRONTMATTER.replace(
      "date: 2026-03-04\n",
      "date: 2026-03-04\noutcome: refuted\nissue: 185\nparent: 0002\n",
    );
    expect(parseIdea(PATH, text)).toMatchObject({
      outcome: "refuted",
      issue: "185",
      parent: "0002",
    });
    expect(parseIdea(PATH, FRONTMATTER)).not.toHaveProperty("outcome");
    expect(parseIdea(PATH, FRONTMATTER)).not.toHaveProperty("issue");
  });

  it("refuses a file name that is not NNNN-slug.md, naming the rename", () => {
    expect(() => parseIdea("docs/ideas/cache.md", FRONTMATTER)).toThrow(
      new IdeaError(
        "docs/ideas/cache.md is not named NNNN-slug.md; rename it to a four-digit number and a lowercase slug.",
      ),
    );
  });

  it("refuses a file with no frontmatter, pointing at the new command", () => {
    expect(() => parseIdea(PATH, "# Idea 0001: x\n")).toThrow(
      /has no frontmatter; start it with ---/,
    );
  });

  it("lists every missing required field, in file order", () => {
    const text = "---\nsummary: x\ndate: 2026-03-04\n---\n";
    expect(() => parseIdea(PATH, text)).toThrow(
      new IdeaError(
        `${PATH} is missing frontmatter hypothesis, expected-outcome, measurement, safety-pattern; add each as a key: value line.`,
      ),
    );
  });

  it("treats an unclosed frontmatter block as no frontmatter", () => {
    expect(() => parseIdea(PATH, "---\nsummary: x\n")).toThrow(
      /has no frontmatter/,
    );
  });
});

describe("scalar", () => {
  it("trims the value and collapses its whitespace onto one line", () => {
    expect(scalar("hypothesis", "  Line one\n\tline   two  ")).toBe(
      "Line one line two",
    );
  });

  it.each([undefined, "", "   "])(
    "refuses a missing or blank --title (%j) and names the flag",
    (value) => {
      expect(() => scalar("title", value)).toThrow(
        new IdeaError("Missing --title; pass a non-empty value."),
      );
    },
  );

  it.each(["-", "[", "{", "|", ">", "&", "*", "!"])(
    "refuses a value that starts with %s, which frontmatter reads as syntax",
    (lead) => {
      expect(() => scalar("hypothesis", `${lead}rest`)).toThrow(
        `--hypothesis must not start with "${lead}"`,
      );
    },
  );
});

describe("renderIdea", () => {
  const idea = {
    title: "Cache the probe results",
    summary: "Cache the probe results",
    hypothesis: "Caching probes cuts up time.",
    expectedOutcome: "Up time drops by 20 percent.",
    measurement: "Compare kore local up duration in the ledger.",
    safetyPattern: "feature-flagged",
  };

  it("writes the frontmatter, then the numbered heading, ending in a newline", () => {
    expect(renderIdea("0001", "2026-03-04", idea)).toBe(FRONTMATTER);
  });

  it("adds the issue and parent links after the date when given", () => {
    const text = renderIdea("0002", "2026-03-04", {
      ...idea,
      issue: "185",
      parent: "0001",
    });
    expect(text).toContain("date: 2026-03-04\nissue: 185\nparent: 0001\n---\n");
    expect(text).toContain("# Idea 0002: Cache the probe results\n");
  });

  it("holds no workflow state such as a status or a label", () => {
    expect(renderIdea("0001", "2026-03-04", idea)).not.toMatch(
      /^(status|label|assignee|approval):/m,
    );
  });
});

describe("withIssue", () => {
  it("inserts an issue line before the closing fence when none exists", () => {
    expect(withIssue(FRONTMATTER, "185")).toBe(
      FRONTMATTER.replace(
        "date: 2026-03-04\n",
        "date: 2026-03-04\nissue: 185\n",
      ),
    );
  });

  it("replaces an existing issue line and touches nothing else", () => {
    const linked = withIssue(FRONTMATTER, "185");
    expect(withIssue(linked, "300")).toBe(
      linked.replace("issue: 185", "issue: 300"),
    );
  });

  it("refuses a file with no frontmatter to record the issue in", () => {
    expect(() => withIssue("# Idea 0001: x\n", "185")).toThrow(
      new IdeaError("The idea has no frontmatter to record the issue in."),
    );
  });
});

describe("outcomeSection and withoutOutcome", () => {
  const WITH = `${FRONTMATTER}\nBody prose.\n\n## Outcome\n\nRefuted by the ledger.\n\n## Next\n\nMore.\n`;

  it("returns the outcome section trimmed, up to the next heading", () => {
    expect(outcomeSection(WITH)).toBe("## Outcome\n\nRefuted by the ledger.");
  });

  it("returns undefined when the idea has no outcome section", () => {
    expect(outcomeSection(FRONTMATTER)).toBeUndefined();
  });

  it("drops CRLF carriage returns from the section", () => {
    const crlf = WITH.replace(/\n/g, "\r\n");
    expect(outcomeSection(crlf)).toBe("## Outcome\n\nRefuted by the ledger.");
  });

  it("runs the outcome section to the end of the file when nothing follows it", () => {
    const last = `${FRONTMATTER}\n## Outcome\n\nDone.`;
    expect(outcomeSection(last)).toBe("## Outcome\n\nDone.");
  });

  it("removes the outcome section and keeps the rest, trimmed at the end", () => {
    expect(withoutOutcome(WITH)).toBe(
      `${FRONTMATTER}\nBody prose.\n\n## Next\n\nMore.`,
    );
  });

  it("returns the text unchanged when there is no outcome section", () => {
    expect(withoutOutcome(FRONTMATTER)).toBe(FRONTMATTER);
  });
});

describe("withOutcome", () => {
  it("records the outcome in the frontmatter and appends the section", () => {
    expect(
      withOutcome(FRONTMATTER, "refuted", "## Outcome\n\nNo gain.\n"),
    ).toBe(
      `${FRONTMATTER.replace(
        "---\n\n# Idea",
        "outcome: refuted\n---\n\n# Idea",
      ).trimEnd()}\n\n## Outcome\n\nNo gain.\n`,
    );
  });

  it("trims the section's surrounding whitespace before appending it", () => {
    expect(withOutcome(FRONTMATTER, "refuted", "\n\n## Outcome\n\nB\n\n")).toBe(
      withOutcome(FRONTMATTER, "refuted", "## Outcome\n\nB"),
    );
  });

  it.each([
    ["has no frontmatter", "# Idea 0001\n\nBody.\n"],
    ["never closes its frontmatter", "---\ntitle: x\n\nBody.\n"],
  ])("refuses an idea that %s, before it changes the text", (_case, text) => {
    expect(() => withOutcome(text, "confirmed", "## Outcome")).toThrow(
      new IdeaError("The idea has no frontmatter to record the outcome in."),
    );
  });
});
