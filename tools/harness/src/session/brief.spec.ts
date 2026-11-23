import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildBrief } from "./brief.js";
import { extractPaths, skillsForPaths } from "./skill-lookup.js";

vi.mock("./skill-lookup.js");

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(extractPaths).mockReturnValue([]);
  vi.mocked(skillsForPaths).mockReturnValue([]);
});

const NO_SKILL = [
  "Skills:",
  "- No skill was named, because the brief names no path that one covers.",
].join("\n");

const TWO_SKILLS = [
  "Skills for the paths you change:",
  "- Load `add-command` and `pin-upgrade` with the Skill tool before you edit.",
].join("\n");

const LIVE_PROOF = [
  "Live proof:",
  "- While a live proof is pinned to a head, change no code, because a change invalidates that proof.",
].join("\n");

const HEAD = [
  "Do the thing.",
  "",
  "You are image-trust-writer; your session name is image-trust-writer.",
  "",
].join("\n");

const input = {
  task: "Do the thing.",
  name: "image-trust-writer",
};

describe("buildBrief", () => {
  it("gives a writer brief the live-proof rule, with the exact text, between the name and the finish instructions", () => {
    expect(buildBrief({ ...input, role: "writer" })).toBe(WRITER_BRIEF);
  });

  it.each(["writer", "fixer"])(
    "keeps the live-proof rule in a %s brief, the role that pushes code",
    (role) => {
      expect(buildBrief({ ...input, role })).toBe(WRITER_BRIEF);
    },
  );

  it.each(["reader", "judge"])(
    "omits the live-proof rule from a %s brief, which never pushes code",
    (role) => {
      expect(buildBrief({ ...input, role })).toBe(READER_BRIEF);
    },
  );

  it("omits the live-proof rule when no role is given", () => {
    expect(buildBrief(input)).toBe(READER_BRIEF);
  });

  it("states no standing rule a writer owns: no local-check, CI, merge or test-driven-development line", () => {
    const brief = buildBrief({ ...input, role: "writer" });
    expect(brief).not.toMatch(
      /Local checks|related tests|pr checks|origin\/main|rebase|Never merge|only the judge|Broadcast only once|test-driven-development|head SHA/,
    );
  });

  it("names the one skill that covers the paths found in the task, without restating test-driven-development", () => {
    vi.mocked(extractPaths).mockReturnValue(["a/b.ts"]);
    vi.mocked(skillsForPaths).mockReturnValue(["add-policy"]);
    const brief = buildBrief({ ...input, role: "writer" });
    expect(extractPaths).toHaveBeenCalledWith("Do the thing.");
    expect(skillsForPaths).toHaveBeenCalledWith(["a/b.ts"]);
    expect(brief).toContain(
      "- Load `add-policy` with the Skill tool before you edit.",
    );
    expect(brief).not.toContain("No skill was named");
  });

  it("lists every skill when paths from two areas match", () => {
    vi.mocked(skillsForPaths).mockReturnValue(["add-command", "pin-upgrade"]);
    expect(buildBrief({ ...input, role: "writer" })).toBe(
      [HEAD, TWO_SKILLS, "", LIVE_PROOF, "", HC_FINISH].join("\n"),
    );
  });

  it("names no skill to a read-only role", () => {
    vi.mocked(skillsForPaths).mockReturnValue(["add-command"]);
    expect(buildBrief({ ...input, role: "reader" })).toBe(READER_BRIEF);
  });
});

const HC_FINISH = [
  "When you finish, print your summary, then as your very last action run `node skills/bin/harness.mjs session report --outcome <done|blocked> --summary <your summary>`, quoting the summary as one argument. For a long summary, write it under .kore/report and pass `--file <path>` in place of `--summary`. Use blocked only when you cannot go on without a person. Each report takes the next seq, so a rework reports again.",
].join("\n");

const HC_FINISH_READ = [
  "When you finish, print your summary, then as your very last action run `node skills/bin/harness.mjs session report --outcome <done|blocked> --summary - <<'EOF'`, with your summary on the lines after it, then a line that reads EOF. Use blocked only when you cannot go on without a person. Each report takes the next seq, so a rework reports again.",
].join("\n");

/** A pushing role's brief: the skills section and the pinned-proof rule sit between the name and the finish. */
const WRITER_BRIEF = [HEAD, NO_SKILL, "", LIVE_PROOF, "", HC_FINISH].join("\n");
/** A read-only role's brief: the same text without the pushing-role sections. */
const READER_BRIEF = [HEAD, HC_FINISH_READ].join("\n");

const HC_GROUP = [
  "Your group is pair-a: a partner session shares it. To message a session you are paired with, run `node skills/bin/harness.mjs session send <peer name>`, where <peer name> is that session's name, given in your task.",
].join("\n");

const HC_INPUT = {
  task: "Do the thing.",
  name: "image-trust-writer",
};

describe("buildBrief on hc", () => {
  it("tells a writer to finish with session report, with the live-proof rule, and names no terminal", () => {
    expect(buildBrief({ ...HC_INPUT, role: "writer" })).toBe(
      [HEAD, NO_SKILL, "", LIVE_PROOF, "", HC_FINISH].join("\n"),
    );
  });

  it("tells a read-only role to finish with session report, without the pushing-role sections", () => {
    expect(buildBrief({ ...HC_INPUT, role: "reader" })).toBe(
      [HEAD, HC_FINISH_READ].join("\n"),
    );
  });

  it("tells a paired session to message its partner with session send <peer name>, never by address", () => {
    expect(buildBrief({ ...HC_INPUT, role: "reader", group: "pair-a" })).toBe(
      [HEAD, HC_GROUP, "", HC_FINISH_READ].join("\n"),
    );
  });

  it("names no callerPane, no notify command and no RESULT line", () => {
    const brief = buildBrief({ ...HC_INPUT, role: "writer" });
    expect(brief).not.toMatch(
      /session notify|RESULT|t\d+|kore-agents|w\d+:p\d+/,
    );
  });
});

describe("buildBrief on hc: the finish a read-only role gets, and when none is added", () => {
  it("names --summary - and no file for a read-only role, so no file is written", () => {
    const brief = buildBrief({ ...HC_INPUT, role: "judgment" });
    expect(brief).toContain("--summary - <<'EOF'");
    expect(brief).not.toMatch(/--file|\.kore\/report/);
  });

  it("keeps the file form for a writer, which can write one", () => {
    expect(buildBrief({ ...HC_INPUT, role: "writer" })).toContain(
      "--file <path>",
    );
  });

  it("adds no second finish when the task already names its own session report", () => {
    const task =
      "Answer the question.\nRun `node skills/bin/harness.mjs session report --outcome done --summary - <<'EOF'` with your answer.";
    const brief = buildBrief({ ...HC_INPUT, task, role: "reader" });

    expect(brief).not.toContain("When you finish");
    expect(brief.startsWith(task)).toBe(true);
    expect(brief.endsWith("\n")).toBe(false);
  });
});
