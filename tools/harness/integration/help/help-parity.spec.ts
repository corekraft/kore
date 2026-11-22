import { describe, expect, it } from "vitest";
import { domains } from "../../src/cli/index.js";
import {
  commandView,
  domainGuides,
  domainView,
  renderJson,
  renderText,
  rootGuide,
  rootView,
  type HelpView,
} from "../../src/help/index.js";

// The prose and the JSON are built from one structure. Each level's facts must
// appear in both, and the JSON must read back as the same object.

// Only the harness domain's commands carry help so far, so the command level uses a
// hand-built command that carries a full record.
const sample = {
  summary: "set the Next: line",
  options: { plan: "string" as const, "dry-run": "boolean" as const },
  run: () => Promise.resolve(0),
};
const sampleHelp = {
  purpose: "Sets the one Next: line under the current step.",
  when: "When the next step of a plan changes.",
  whenNot: "When only reading the plan; use plan active.",
  flags: {
    plan: "The plan number.",
    "dry-run": "Reports the changes without writing them.",
  },
  examples: [
    { command: "harness plan next --plan 3", shows: "the Next: line it set" },
  ],
  exits: [{ code: 0, meaning: "the Next: line is set" }],
  effects: {
    kind: "mutates" as const,
    detail: "rewrites the Next: line of one plan file",
  },
  seeAlso: ["plan active"],
};

// Every string a view carries, except the enum-like tags the prose shows as words.
function factsOf(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(factsOf);
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value)
      .filter(([key]) => key !== "level" && key !== "kind")
      .flatMap(([, inner]) => factsOf(inner));
  }
  return [];
}

const views: [string, HelpView][] = [
  ["root", rootView(rootGuide, domainGuides)],
  ["domain", domainView("plan", domains.plan ?? {}, domainGuides.plan!)],
  ["command", commandView("plan next", sample, sampleHelp)],
];

describe("the prose and the JSON at each level", () => {
  for (const [level, view] of views) {
    it(`carry the same facts at the ${level} level, and the JSON reads back as the same object`, () => {
      const text = renderText(view);
      expect(JSON.parse(renderJson(view))).toEqual(view);
      for (const fact of factsOf(view)) {
        expect(text, fact).toContain(fact);
      }
    });
  }
});
