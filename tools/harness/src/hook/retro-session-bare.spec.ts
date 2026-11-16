// One session's bare sends and spawn-brief session name as a unit: the transcript
// helpers and the bare classifier are mocked, so only SessionAnalysis runs.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { bareSends } from "./retro-bare.js";
import {
  blocksOf,
  briefSessionName,
  humanText,
  type Block,
  type TranscriptEvent,
} from "./retro-transcript.js";
import { bashUse, session } from "./retro-session-support.js";

vi.mock("./retro-transcript.js");
vi.mock("./retro-bare.js");

const { SessionAnalysis } = await import("./retro-session.js");

const BRIEF = "Implement #836.\n\nYou are w1; your session name is w1.";

const typed = (line: number): TranscriptEvent => ({
  line,
  type: "user",
  message: { content: "typed" },
});

beforeEach(() => {
  vi.mocked(blocksOf).mockImplementation(
    (event) => (event.message?.content as Block[] | undefined) ?? [],
  );
  vi.mocked(humanText).mockReturnValue(null);
  vi.mocked(briefSessionName).mockReturnValue(undefined);
  vi.mocked(bareSends).mockReturnValue([]);
});

describe("session analysis: the session name a spawn brief gives", () => {
  it("names the session from the spawn brief its first typed message carries", () => {
    vi.mocked(humanText).mockImplementation((event) =>
      event.line === 1 ? BRIEF : null,
    );
    vi.mocked(briefSessionName).mockImplementation((text) =>
      text === BRIEF ? "w1" : undefined,
    );
    const found = new SessionAnalysis(session([typed(1)]));
    expect(vi.mocked(briefSessionName)).toHaveBeenCalledWith(BRIEF);
    expect(found.sessionName).toBe("w1");
  });

  it("names no session when the first typed message is not a brief", () => {
    vi.mocked(humanText).mockImplementation((event) =>
      event.line === 1 ? "Please check the report" : null,
    );
    const found = new SessionAnalysis(session([typed(1)]));
    expect(found.sessionName).toBeUndefined();
  });
});

describe("session analysis: the bare sends a session makes", () => {
  it("counts each bare send in the Bash command text, and nothing for a call that makes none", () => {
    vi.mocked(bareSends).mockImplementation((command) => {
      if (command.startsWith("gh")) {
        return ["gh"];
      }
      return command.startsWith("herdr") ? ["herdr"] : [];
    });
    const found = new SessionAnalysis(
      session([
        bashUse(2, "t1", "gh issue comment 836 --body done"),
        bashUse(3, "t2", "herdr pane send-text w2:p1 hi"),
        bashUse(4, "t3", "npm test"),
      ]),
    );
    expect(vi.mocked(bareSends)).toHaveBeenCalledWith(
      "gh issue comment 836 --body done",
    );
    expect(found.bare).toEqual({ gh: 1, herdr: 1 });
  });

  it("counts no bare send from a tool call that is not Bash", () => {
    vi.mocked(bareSends).mockReturnValue(["gh"]);
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
                name: "Read",
                input: { command: "gh pr comment 1" },
              },
            ],
          },
        },
      ]),
    );
    expect(vi.mocked(bareSends)).not.toHaveBeenCalled();
    expect(found.bare).toEqual({ gh: 0, herdr: 0 });
  });
});
