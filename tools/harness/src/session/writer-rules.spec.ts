import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildBrief } from "./brief.js";

const WRITER = readFileSync(
  join(import.meta.dirname, "../../../../.claude/agents/writer.md"),
  "utf8",
);

const IDEA_0015 = readFileSync(
  join(
    import.meta.dirname,
    "../../../../docs/ideas/0015-writer-follow-up-rules.md",
  ),
  "utf8",
);

/** The #849 cut on #803, as idea 0015 records it: the counts before and after #553, and the owner. */
const CUT_LINES: readonly string[] = [
  "- Before #553: 33 sessions with habit follow-ups, 2 with real breaks; 54 follow-ups counted: 49 habit, 2 real break, 3 dropped.",
  "- After #553: 4 sessions with habit follow-ups, 1 with real breaks; 19 follow-ups counted: 6 habit, 4 real break, 9 dropped.",
  '- Owner of "run related tests, not the full suite": writer.md, alone (advisor decision on #803, 2026-11-17).',
];

/** Each standing writer rule, as the sentence that states it in writer.md. */
const STANDING_RULES: Record<string, string> = {
  "merge origin/main, never rebase or force-push":
    "Merge `origin/main` into your branch; never rebase or force-push.",
  "run pr checks --wait once after each push, fix red, never loop":
    "After each push, run `node skills/bin/harness.mjs pr checks <pr> --wait` once, print the new head SHA in your summary, and fix a red run; never loop on the wait.",
  "read a long run's output file instead of sleeping":
    "For a run that takes long, start it in the background and read its output file when it finishes; do not sleep to wait for it.",
  "broadcast only once, at the finish":
    "Broadcast only once, when you finish, with `harness session notify`, the command at the end of your brief.",
  "run only the related tests locally":
    "Locally run only the related tests and typecheck; the full suites run in CI `check` (AGENTS.md, Changes).",
  "never merge, only the judge merges":
    "You never merge: only the judge merges, through its merge tool, after re-running the precheck.",
};

/** How many times the sentence appears in the text, so a rule stated twice shows as 2. */
function occurrences(text: string, sentence: string): number {
  return text.split(sentence).length - 1;
}

describe("each standing writer rule has one owner, writer.md", () => {
  it.each(Object.entries(STANDING_RULES))(
    "states the rule to %s exactly once in writer.md",
    (_rule, sentence) => {
      expect(occurrences(WRITER, sentence)).toBe(1);
    },
  );

  it.each(Object.entries(STANDING_RULES))(
    "keeps the rule to %s out of a pushing role's brief, which writer.md owns",
    (_rule, sentence) => {
      const brief = buildBrief({
        task: "Do the thing.",
        name: "writer-rule-owners",
        callerPane: "w3:p1",
        role: "writer",
      });
      expect(brief).not.toContain(sentence);
    },
  );
});

describe("idea 0015 records the #849 cut before any rule moved", () => {
  it.each(CUT_LINES.map((line) => [line]))(
    "records the cut line %s in the idea record",
    (line) => {
      expect(IDEA_0015).toContain(line);
    },
  );
});
