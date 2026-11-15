// A harness idea's record (#214): rendered, read back, and created from flags.
import { describe, expect, it } from "vitest";
import {
  IdeaError,
  harnessHypothesis,
  parseIdea,
  renderIdea,
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

const HARNESS_BLOCK =
  "kind: harness\nhypothesis-metric: friction.total\nhypothesis-direction: down\nhypothesis-window: 14d\n";
const HARNESS = {
  metric: "friction.total",
  direction: "down" as const,
  window: "14d",
};

describe("a harness idea", () => {
  const idea = {
    title: "Cache the probe results",
    summary: "Cache the probe results",
    hypothesis: "Caching probes cuts up time.",
    expectedOutcome: "Up time drops by 20 percent.",
    measurement: "Compare kore local up duration in the ledger.",
    safetyPattern: "feature-flagged",
  };

  it("is rendered with its kind and hypothesis block after the date", () => {
    expect(
      renderIdea("0001", "2026-03-04", { ...idea, harness: HARNESS }),
    ).toBe(
      FRONTMATTER.replace(
        "date: 2026-03-04\n",
        `date: 2026-03-04\n${HARNESS_BLOCK}`,
      ),
    );
  });

  it("is read back with its hypothesis block", () => {
    const text = FRONTMATTER.replace(
      "date: 2026-03-04\n",
      `date: 2026-03-04\n${HARNESS_BLOCK}`,
    );
    expect(parseIdea(PATH, text).harness).toEqual(HARNESS);
  });

  it("is refused on read when its hypothesis block lacks a field, naming exactly which", () => {
    const text = FRONTMATTER.replace(
      "date: 2026-03-04\n",
      "date: 2026-03-04\nkind: harness\nhypothesis-metric: friction.total\n",
    );
    expect(() => parseIdea(PATH, text)).toThrow(
      new IdeaError(
        `${PATH} is a harness idea missing frontmatter hypothesis-direction, hypothesis-window; add each as a key: value line.`,
      ),
    );
  });

  it("is refused on read when its direction is neither up nor down, not read as down", () => {
    const text = FRONTMATTER.replace(
      "date: 2026-03-04\n",
      "date: 2026-03-04\nkind: harness\nhypothesis-metric: friction.total\nhypothesis-direction: sideways\nhypothesis-window: 14d\n",
    );
    expect(() => parseIdea(PATH, text)).toThrow(
      new IdeaError(
        `${PATH} has hypothesis-direction sideways; use up or down.`,
      ),
    );
  });

  it("is not assumed of an ordinary idea, which reads back with no harness block", () => {
    expect(parseIdea(PATH, FRONTMATTER)).not.toHaveProperty("harness");
    expect(renderIdea("0001", "2026-03-04", idea)).not.toContain("kind:");
  });
});

describe("harnessHypothesis", () => {
  const METRICS = ["friction.total", "outcomes.mainRed.rate"];
  const flags = {
    kind: "harness",
    metric: "friction.total",
    direction: "down",
    window: "14d",
  };

  it("is undefined for an ordinary idea, so existing ideas are created exactly as before", () => {
    expect(harnessHypothesis({}, METRICS)).toBeUndefined();
  });

  it("returns the metric, direction and window of a complete harness idea", () => {
    expect(harnessHypothesis(flags, METRICS)).toEqual(HARNESS);
  });

  it("names exactly the flags a harness idea is missing", () => {
    expect(() =>
      harnessHypothesis({ kind: "harness", direction: "up" }, METRICS),
    ).toThrow(
      new IdeaError(
        "A harness idea is missing --metric, --window; pass each, e.g. --metric friction.total --direction down --window 14d.",
      ),
    );
  });

  it("refuses an unknown metric and lists the valid ones", () => {
    expect(() =>
      harnessHypothesis({ ...flags, metric: "vibes" }, METRICS),
    ).toThrow(
      new IdeaError(
        '--metric "vibes" is not a flow report metric; use one of friction.total, outcomes.mainRed.rate (see `harness flow report --json`).',
      ),
    );
  });

  it("refuses a direction that is not up or down, and a window that is not days", () => {
    expect(() =>
      harnessHypothesis({ ...flags, direction: "sideways" }, METRICS),
    ).toThrow(new IdeaError('--direction "sideways" is not up or down.'));
    expect(() =>
      harnessHypothesis({ ...flags, window: "soon" }, METRICS),
    ).toThrow(
      new IdeaError('--window "soon" is not a number of days such as 14d.'),
    );
  });

  it("refuses a kind other than harness, and hypothesis flags with no kind", () => {
    expect(() => harnessHypothesis({ ...flags, kind: "x" }, METRICS)).toThrow(
      new IdeaError(
        '--kind "x" is not recognised; use harness, or leave it out.',
      ),
    );
    expect(() =>
      harnessHypothesis({ metric: "friction.total" }, METRICS),
    ).toThrow(
      new IdeaError(
        "--metric needs --kind harness; add it, or leave the hypothesis flags out.",
      ),
    );
  });
});
