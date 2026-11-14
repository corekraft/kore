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

beforeEach(() => {
  vi.mocked(blocksOf).mockImplementation(
    (event) => (event.message?.content as Block[] | undefined) ?? [],
  );
  vi.mocked(humanText).mockReturnValue(null);
  vi.mocked(resultText).mockImplementation((block) => String(block.content));
  vi.mocked(summarizeError).mockImplementation((text) => `summary of ${text}`);
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
