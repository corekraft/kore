// Which rule a guard block is attributed to: the message's own leading tag,
// never a tag quoted later in the blocked command. The transcript helpers are
// mocked, so only SessionAnalysis runs.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  blocksOf,
  humanText,
  resultText,
  summarizeError,
  type Block,
} from "./retro-transcript.js";

import { session, toolUse, toolError } from "./retro-session-support.js";

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

const blockedRules = (text: string): string[] =>
  new SessionAnalysis(
    session([toolUse(2, "t1"), toolError(3, "t1", text)]),
  ).guardBlocks.map((block) => block.rule);

describe("session analysis guard block attribution", () => {
  it("counts only the leading tag when the quoted command names another rule", () => {
    expect(
      blockedRules("[guard:image-digest] refused: echo '[guard:audit-x]'"),
    ).toEqual(["image-digest"]);
  });

  it("counts the leading tag once when the message repeats it", () => {
    expect(
      blockedRules("[guard:role-worktree] first [guard:role-worktree]"),
    ).toEqual(["role-worktree"]);
  });

  it("counts the leading tag behind the hook error prefix of a real block", () => {
    expect(
      blockedRules(
        'PreToolUse:Bash hook error: ["$DIR/harness.sh" hook guard]: [guard:image-digest] refused: [guard:audit-x]',
      ),
    ).toEqual(["image-digest"]);
  });

  it("counts nothing when the message has no leading tag but quotes one later", () => {
    expect(blockedRules("Exit code 1\necho '[guard:audit-x]'")).toEqual([]);
  });
});
