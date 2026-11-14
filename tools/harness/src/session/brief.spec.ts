import { describe, expect, it } from "vitest";
import { buildBrief } from "./brief.js";

const FINISH = [
  "When you finish, broadcast to pane `w3:p1`. Print your summary and a final line with the word RESULT, a colon, then done or blocked. Then, as your very last action, run this one line with the outcome word (done or blocked) in place of <done|blocked>; the command fills in your own name and pane, and must carry no secrets or output beyond the outcome word:",
  "",
  "node skills/bin/harness.mjs session notify w3:p1 --outcome <done|blocked>",
].join("\n");

const FOLLOW_UP = [
  "Review follow-up:",
  "- After each fix push, print the new head SHA in your summary and wait for CI to pass before the next change.",
  "- Never merge; only the judge merges.",
  "- Broadcast only once, when you finish, with harness session notify (the command at the end of this brief).",
  "- While a live proof is pinned to a head, change no code, because a change invalidates that proof.",
].join("\n");

const LOCAL_CHECKS = [
  "Local checks:",
  "- Locally run only the related tests and typecheck; the full suites run in CI `check` (AGENTS.md, Changes).",
].join("\n");

const HEAD = [
  "Do the thing.",
  "",
  "You are image-trust-writer; your session name is image-trust-writer.",
  "",
].join("\n");

/** A pushing role's brief: the local-checks rule, then the follow-up section, sit between the name and the finish instructions. */
const WRITER_BRIEF = [HEAD, LOCAL_CHECKS, "", FOLLOW_UP, "", FINISH].join("\n");
/** A read-only role's brief: the same text without the pushing-role sections. */
const READER_BRIEF = [HEAD, FINISH].join("\n");

const input = {
  task: "Do the thing.",
  name: "image-trust-writer",
  callerPane: "w3:p1",
};

describe("buildBrief", () => {
  it("gives a writer brief the review follow-up section, with the exact text, between the name and the finish instructions", () => {
    expect(buildBrief({ ...input, role: "writer" })).toBe(WRITER_BRIEF);
  });

  it.each(["writer", "fixer"])(
    "keeps the review follow-up section in a %s brief, the role that pushes code",
    (role) => {
      expect(buildBrief({ ...input, role })).toBe(WRITER_BRIEF);
    },
  );

  it.each(["reader", "judge", "challenger"])(
    "omits the review follow-up section from a %s brief, which never pushes code",
    (role) => {
      expect(buildBrief({ ...input, role })).toBe(READER_BRIEF);
    },
  );

  it("omits the review follow-up section when no role is given", () => {
    expect(buildBrief(input)).toBe(READER_BRIEF);
  });
});
