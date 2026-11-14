// One session's analysis as a unit: the guard blocks, warnings and counted
// corrections it records. The transcript helpers are mocked, so only
// SessionAnalysis runs.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  blocksOf,
  callSignature,
  humanText,
  isOrchestratorBrief,
  ownWords,
  phrasesOf,
  readsAsCorrection,
  resultText,
  summarizeError,
  type Block,
  type Transcript,
  type TranscriptEvent,
} from "./retro-transcript.js";

import {
  session,
  toolUse,
  toolError,
  bashUse,
  warningAttachment,
} from "./retro-session-support.js";

vi.mock("./retro-transcript.js");

const { SessionAnalysis } = await import("./retro-session.js");

beforeEach(() => {
  vi.mocked(blocksOf).mockImplementation(
    (event) => (event.message?.content as Block[] | undefined) ?? [],
  );
  vi.mocked(humanText).mockReturnValue(null);
  vi.mocked(resultText).mockImplementation((block) => String(block.content));
  vi.mocked(summarizeError).mockImplementation((text) => `summary of ${text}`);
});

describe("session analysis warnings", () => {
  it("records each warning with its transcript line and the command of the call it warned about", () => {
    const found = new SessionAnalysis(
      session([
        bashUse(3, "t1", "ls skills/*/SKILL.md"),
        warningAttachment(
          4,
          "t1",
          "[guard:bare-glob] Quote the glob so zsh does not fail the command.",
        ),
      ]),
    );
    expect(found.warnings).toEqual([
      {
        rule: "bare-glob",
        toolUseId: "t1",
        line: 4,
        excerpt: "ls skills/*/SKILL.md",
        glob: "",
      },
    ]);
  });
});

describe("session analysis warning globs", () => {
  it("records the unquoted glob the guard names, and leaves glob empty when it names none", () => {
    const found = new SessionAnalysis(
      session([
        bashUse(3, "t1", "ls skills/*/SKILL.md"),
        warningAttachment(
          4,
          "t1",
          "[guard:bare-glob] skills/*/SKILL.md is an unquoted glob; zsh fails the whole command.",
        ),
        bashUse(6, "t2", "echo hi"),
        warningAttachment(7, "t2", "[guard:bare-glob] Quote the glob."),
      ]),
    );
    expect(found.warnings.map((warning) => warning.glob)).toEqual([
      "skills/*/SKILL.md",
      "",
    ]);
  });

  it("keeps only the first line of a command, capped at 120 characters", () => {
    const command = `${"x".repeat(200)}\nsecond line`;
    const found = new SessionAnalysis(
      session([
        bashUse(2, "t1", command),
        warningAttachment(3, "t1", "[guard:bare-glob] quote it"),
      ]),
    );
    expect(found.warnings[0]?.excerpt).toBe("x".repeat(120));
  });

  it("uses the tool name as the excerpt when the warned call has no command", () => {
    const found = new SessionAnalysis(
      session([
        {
          line: 2,
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                id: "t1",
                name: "Edit",
                input: { file_path: "a.ts" },
              },
            ],
          },
        },
        warningAttachment(3, "t1", "[guard:bare-glob] quote it"),
      ]),
    );
    expect(found.warnings[0]?.excerpt).toBe("Edit");
  });
});

describe("session analysis guard blocks", () => {
  it("records each blocked rule with the line of the blocked result and its excerpt", () => {
    const found = new SessionAnalysis(
      session([
        toolUse(3, "t1"),
        toolError(
          4,
          "t1",
          "[guard:role-worktree] reaches outside the worktree",
        ),
        toolUse(6, "t2"),
        toolError(7, "t2", "[guard:unquoted-glob] is unquoted"),
      ]),
    );
    expect(found.guardBlocks).toEqual([
      {
        rule: "role-worktree",
        line: 4,
        excerpt:
          "summary of [guard:role-worktree] reaches outside the worktree",
      },
      {
        rule: "unquoted-glob",
        line: 7,
        excerpt: "summary of [guard:unquoted-glob] is unquoted",
      },
    ]);
  });

  it("counts only the leading tag when the quoted command text names another rule", () => {
    const found = new SessionAnalysis(
      session([
        toolUse(2, "t1"),
        toolError(
          3,
          "t1",
          "[guard:image-digest] refused: echo '[guard:audit-x] [guard:image-digest]'",
        ),
      ]),
    );
    expect(found.guardBlocks.map((block) => [block.rule, block.line])).toEqual([
      ["image-digest", 3],
    ]);
    expect(found.guards["audit-x"]).toBeUndefined();
  });

  it("leaves a plain failure out of the guard blocks, and keeps it as a failure", () => {
    const found = new SessionAnalysis(
      session([
        toolUse(2, "t1"),
        toolError(3, "t1", "Exit code 1\nfatal: boom"),
      ]),
    );
    expect(found.guardBlocks).toEqual([]);
    expect(found.failures).toEqual([
      { tool: "Bash", error: "summary of Exit code 1\nfatal: boom" },
    ]);
  });
});

describe("session analysis counts a repeated prompt as a correction", () => {
  const briefSession = (...texts: string[]): Transcript => ({
    id: "s",
    skipped: 0,
    events: texts.map((_text, index) => ({ line: index + 1, type: "user" })),
  });

  beforeEach(() => {
    vi.mocked(callSignature).mockReturnValue("");
    vi.mocked(ownWords).mockImplementation((text: string) => text);
    vi.mocked(phrasesOf).mockImplementation((text: string) => [text]);
  });

  it("does not count a message that reads as an orchestrator brief", () => {
    const brief = "[orchestrator] Stop editing the widget manifests directly";
    vi.mocked(humanText).mockReturnValue(brief);
    vi.mocked(isOrchestratorBrief).mockImplementation((text) =>
      text.startsWith("[orchestrator]"),
    );
    vi.mocked(readsAsCorrection).mockReturnValue(true);
    expect(new SessionAnalysis(briefSession(brief)).phrases).toEqual([]);
  });

  it("still counts an untagged user correction", () => {
    const correction = "Stop editing the widget manifests directly";
    vi.mocked(humanText).mockReturnValue(correction);
    vi.mocked(isOrchestratorBrief).mockReturnValue(false);
    vi.mocked(readsAsCorrection).mockReturnValue(true);
    expect(new SessionAnalysis(briefSession(correction)).phrases).toEqual([
      { phrase: correction, line: 1 },
    ]);
  });
});

describe("session analysis: what the agent did after a warning", () => {
  const human = (line: number): TranscriptEvent => ({
    line,
    type: "user",
    message: { content: "human" },
  });
  const warn = (line: number, id = "t1") =>
    warningAttachment(line, id, "[guard:bare-glob] quote it");
  const outcomeOf = (...events: TranscriptEvent[]) => {
    const found = new SessionAnalysis(session(events));
    const warned = found.warnings[0];
    if (warned === undefined) {
      throw new Error("no warning was recorded");
    }
    return found.outcome(warned);
  };

  beforeEach(() => {
    vi.mocked(callSignature).mockImplementation((input = {}) =>
      String(input["command"]),
    );
    vi.mocked(humanText).mockImplementation((event) =>
      event.message?.content === "human" ? "human" : null,
    );
    vi.mocked(ownWords).mockImplementation((text: string) => text);
    vi.mocked(phrasesOf).mockReturnValue([]);
  });

  it.each([
    [
      "overridden",
      "the person speaks before the agent acts again",
      [bashUse(1, "t1", "ls a"), warn(2), human(3)],
    ],
    [
      "repeated",
      "the agent repeats the same call",
      [bashUse(1, "t1", "ls a"), warn(2), bashUse(3, "t2", "ls a")],
    ],
    [
      "heeded",
      "the agent makes a different call",
      [bashUse(1, "t1", "ls a"), warn(2), bashUse(3, "t2", "ls b")],
    ],
    [
      "unresolved",
      "nothing follows the warned call",
      [bashUse(1, "t1", "ls a"), warn(2)],
    ],
    ["unresolved", "the warned call is not in the transcript", [warn(2, "zz")]],
  ])("reads a warning as %s when %s", (expected, _why, events) => {
    expect(outcomeOf(...events)).toBe(expected);
  });
});

describe("session analysis: the skills it records", () => {
  it("records a skill the agent invoked through the Skill tool", () => {
    const skillUse: TranscriptEvent = {
      line: 1,
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "t9",
            name: "Skill",
            input: { skill: "tdd" },
          },
        ],
      },
    };
    expect([...new SessionAnalysis(session([skillUse])).skills]).toEqual([
      "tdd",
    ]);
  });
});
