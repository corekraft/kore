import { describe, expect, it } from "vitest";
import { IdeaError } from "../idea/index.js";
import {
  followUpOf,
  labelFor,
  markerFor,
  OUTCOME_KINDS,
  OUTCOME_SOURCES,
  parseOutcome,
  RESULTS,
  renderSection,
} from "./model.js";
import { ideaRecord, outcome } from "./outcome-support.js";

const valid = {
  kind: "experiment",
  source: "comparison",
  result: "confirmed",
  evidence: "kore local up p50 41s before, 29s after",
  summary: "Up time fell from 41s to 29s.",
};

describe("the outcome vocabulary", () => {
  it("names the kinds, sources and results the outcome tool accepts, in order", () => {
    expect(OUTCOME_KINDS).toEqual(["experiment", "usage", "verification"]);
    expect(OUTCOME_SOURCES).toEqual([
      "live-run",
      "journal",
      "eval-history",
      "comparison",
    ]);
    expect(RESULTS).toEqual(["confirmed", "refuted", "inconclusive"]);
  });

  it("labels an outcome on its issue by its result", () => {
    expect(labelFor("refuted")).toBe("outcome:refuted");
  });

  it("marks an idea's outcome comment with its number, so a rerun can find it", () => {
    expect(markerFor(ideaRecord({ number: "0042" }))).toBe(
      "<!-- harness outcome idea 0042 -->",
    );
  });
});

describe("parseOutcome accepted input", () => {
  it("returns the outcome with trimmed fields and evidence whitespace collapsed", () => {
    expect(
      parseOutcome({
        ...valid,
        kind: " usage ",
        evidence: "  a\n  b  ",
        summary: "  Up  time  ",
      }),
    ).toEqual({
      kind: "usage",
      source: "comparison",
      result: "confirmed",
      evidence: "a b",
      summary: "Up  time",
    });
  });

  it("carries no flag field when neither --flag nor --environment is given", () => {
    expect(parseOutcome(valid)).not.toHaveProperty("flag");
  });

  it("carries the flag and environment on a live verification", () => {
    expect(
      parseOutcome({
        ...valid,
        kind: "verification",
        source: "live-run",
        flag: "ingress-agentgateway",
        environment: "local",
      }),
    ).toMatchObject({
      flag: { name: "ingress-agentgateway", environment: "local" },
    });
  });
});

describe("parseOutcome refusals of kind, source and result", () => {
  it.each([
    [undefined, "Missing --kind; pass one of experiment, usage, verification."],
    ["  ", "Missing --kind; pass one of experiment, usage, verification."],
    [
      "guess",
      '--kind "guess" is not recognised; use one of experiment, usage, verification.',
    ],
  ])("rejects --kind %j with the allowed values", (kind, message) => {
    expect(() => parseOutcome({ ...valid, kind })).toThrow(
      new IdeaError(message),
    );
  });

  it("rejects an unknown source with the allowed values", () => {
    expect(() => parseOutcome({ ...valid, source: "vibes" })).toThrow(
      new IdeaError(
        '--source "vibes" is not recognised; use one of live-run, journal, eval-history, comparison.',
      ),
    );
  });

  it("rejects an unknown result with the allowed values", () => {
    expect(() => parseOutcome({ ...valid, result: "won" })).toThrow(
      new IdeaError(
        '--result "won" is not recognised; use one of confirmed, refuted, inconclusive.',
      ),
    );
  });
});

describe("parseOutcome refusals of text", () => {
  it("rejects a blank evidence and a blank summary, naming what each needs", () => {
    expect(() => parseOutcome({ ...valid, evidence: " " })).toThrow(
      new IdeaError(
        "Missing --evidence; name the run, journal entry, eval record or comparison it was measured on.",
      ),
    );
    expect(() => parseOutcome({ ...valid, summary: undefined })).toThrow(
      new IdeaError(
        "Missing --summary; state what was observed against the idea's expected outcome.",
      ),
    );
  });

  it.each([
    ["summary", { summary: "x <!-- harness outcome idea 0001 -->" }],
    ["evidence", { evidence: "x <!-- harness outcome idea 0001 -->" }],
  ])(
    "rejects an HTML comment in the %s, which could forge the posted marker",
    (_field, override) => {
      expect(() => parseOutcome({ ...valid, ...override })).toThrow(
        new IdeaError(
          "--summary and --evidence must not contain an HTML comment; it could forge the marker that tells a rerun the outcome is posted, so reword it.",
        ),
      );
    },
  );

  it.each(["- Environment: local", "- Result: confirmed", "- Flag: x"])(
    "rejects a summary line %j that would override a recorded field",
    (line) => {
      expect(() =>
        parseOutcome({ ...valid, summary: `Worked.\n${line}` }),
      ).toThrow(
        new IdeaError(
          '--summary must not start a line with "- Name:"; it could override a recorded field such as Flag or Result, so reword it.',
        ),
      );
    },
  );

  it("rejects a summary line that would open a new section in the idea", () => {
    expect(() =>
      parseOutcome({ ...valid, summary: "ok\n## Hypothesis\nx" }),
    ).toThrow(
      new IdeaError(
        "--summary must not start a line with #; it would open a new section in the idea, so reword it.",
      ),
    );
  });
});

describe("parseOutcome refusals of flag proof", () => {
  const live = {
    ...valid,
    kind: "verification",
    source: "live-run",
    flag: "ingress-agentgateway",
    environment: "local",
  };

  it("rejects --flag without --environment, and names the other flag it was given", () => {
    expect(() => parseOutcome({ ...valid, flag: "x" })).toThrow(
      new IdeaError(
        "Missing --environment; a flag outcome names both --flag and --environment (got only --flag).",
      ),
    );
  });

  it("rejects --environment without --flag", () => {
    expect(() => parseOutcome({ ...valid, environment: "local" })).toThrow(
      new IdeaError(
        "Missing --flag; a flag outcome names both --flag and --environment (got only --environment).",
      ),
    );
  });

  it("rejects a flag or environment name that is not lowercase letters, digits and hyphens", () => {
    expect(() => parseOutcome({ ...live, flag: "Bad Flag" })).toThrow(
      new IdeaError(
        '--flag "Bad Flag" must be lowercase letters, digits and hyphens, starting with a letter.',
      ),
    );
    expect(() => parseOutcome({ ...live, environment: "1local" })).toThrow(
      new IdeaError(
        '--environment "1local" must be lowercase letters, digits and hyphens, starting with a letter.',
      ),
    );
  });

  it("rejects flag proof that is not a live-run verification, naming the kind and source it has", () => {
    expect(() => parseOutcome({ ...live, kind: "experiment" })).toThrow(
      new IdeaError(
        "--flag proves a flag only on --kind verification with --source live-run (got experiment from live-run); a different outcome cannot activate it.",
      ),
    );
    expect(() => parseOutcome({ ...live, source: "journal" })).toThrow(
      new IdeaError(
        "--flag proves a flag only on --kind verification with --source live-run (got verification from journal); a different outcome cannot activate it.",
      ),
    );
  });
});

describe("renderSection", () => {
  it("renders the outcome section exactly, with the date it was recorded", () => {
    expect(renderSection(outcome(), "2026-11-14")).toBe(
      [
        "## Outcome",
        "",
        "- Result: confirmed",
        "- Kind: experiment",
        "- Source: comparison",
        "- Evidence: kore local up p50 41s before, 29s after",
        "- Recorded: 2026-11-14",
        "",
        "Up time fell from 41s to 29s.",
      ].join("\n"),
    );
  });

  it("puts the flag and environment lines after the source, and only for a flag outcome", () => {
    const flagged = outcome({
      kind: "verification",
      source: "live-run",
      flag: { name: "ingress-agentgateway", environment: "local" },
    });
    expect(renderSection(flagged, "2026-11-14")).toBe(
      [
        "## Outcome",
        "",
        "- Result: confirmed",
        "- Kind: verification",
        "- Source: live-run",
        "- Flag: ingress-agentgateway",
        "- Environment: local",
        "- Evidence: kore local up p50 41s before, 29s after",
        "- Recorded: 2026-11-14",
        "",
        "Up time fell from 41s to 29s.",
      ].join("\n"),
    );
  });
});

describe("followUpOf", () => {
  it("describes a follow-up that revisits the same claim and links back to its parent", () => {
    expect(followUpOf(ideaRecord(), "refuted")).toEqual({
      slug: "follow-up-0001-cache-the-probe-results",
      idea: {
        title: "Follow up: Cache the probe results",
        summary: "Follow up on idea 0001 after a refuted outcome",
        hypothesis:
          "After a refuted outcome on idea 0001, revisit: Caching the probe results cuts up time.",
        expectedOutcome: "Up time falls below 30s.",
        measurement: "kore local up p50 before and after.",
        safetyPattern: "no-behaviour-change",
        parent: "0001",
      },
    });
  });

  it("cuts a long slug to 60 characters and drops a hyphen left at the cut", () => {
    const slug = `${"x".repeat(44)}-yyyy`;
    const { slug: followUpSlug } = followUpOf(ideaRecord({ slug }), "refuted");
    expect(followUpSlug).toBe(`follow-up-0001-${"x".repeat(44)}`);
  });
});
