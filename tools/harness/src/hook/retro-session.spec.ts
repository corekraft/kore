// One session's analysis: the guard blocks it records, with the line of each.
// Unit spec: the transcript helpers are mocked, so only SessionAnalysis runs.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  blocksOf,
  humanText,
  resultText,
  summarizeError,
  type Block,
  type Transcript,
  type TranscriptEvent,
} from "./retro-transcript.js";

vi.mock("./retro-transcript.js");

const { SessionAnalysis } = await import("./retro-session.js");

const session = (events: TranscriptEvent[]): Transcript => ({
  id: "s",
  events,
  skipped: 0,
});

const toolUse = (line: number, id: string): TranscriptEvent => ({
  line,
  type: "assistant",
  message: { content: [{ type: "tool_use", id, name: "Bash", input: {} }] },
});

const toolError = (
  line: number,
  id: string,
  text: string,
): TranscriptEvent => ({
  line,
  type: "user",
  message: {
    content: [
      { type: "tool_result", tool_use_id: id, is_error: true, content: text },
    ],
  },
});

const bashUse = (
  line: number,
  id: string,
  command: string,
): TranscriptEvent => ({
  line,
  type: "assistant",
  message: {
    content: [{ type: "tool_use", id, name: "Bash", input: { command } }],
  },
});

const warningAttachment = (
  line: number,
  toolUseID: string,
  content: string,
): TranscriptEvent => ({
  line,
  type: "attachment",
  attachment: { type: "hook_additional_context", content, toolUseID },
});

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
      },
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

  it("records one entry per rule when one result names the same rule twice", () => {
    const found = new SessionAnalysis(
      session([
        toolUse(2, "t1"),
        toolError(
          3,
          "t1",
          "[guard:role-worktree] first [guard:role-worktree] again",
        ),
      ]),
    );
    expect(found.guardBlocks.map((block) => [block.rule, block.line])).toEqual([
      ["role-worktree", 3],
    ]);
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
