// The transcript reader as a unit: pure functions over JSONL text and events,
// with no dependencies to mock. Each guarantee is pinned to its exact output.

import { describe, expect, it } from "vitest";
import { FOLLOW_UP_PREFIX } from "../session/index.js";
import {
  blocksOf,
  callSignature,
  humanText,
  isOrchestratorBrief,
  ownWords,
  parseTranscript,
  phrasesOf,
  readsAsCorrection,
  resultText,
  summarizeError,
  timestamps,
} from "./retro-transcript.js";

describe("orchestrator brief tag", () => {
  it.each([
    ["the fixed [orchestrator] tag", "[orchestrator] Retro ticket #411"],
    ["the fixed tag after indentation, any case", "  \n [ORCHESTRATOR] brief"],
    ["the legacy (orchestrator) header", "(orchestrator) brief"],
    ["the legacy orchestrator: header", "Orchestrator: brief"],
    ["a [herdr:name] header", "[herdr:retro-writer] brief"],
  ])("reads a message that opens with %s as a brief", (_name, text) => {
    expect(isOrchestratorBrief(text)).toBe(true);
  });

  it.each([
    [
      "a brief that holds the session-name line, with no tag",
      "Retro ticket #496\n\nYou are retro-writer; your session name is retro-writer.\n\nWhen you finish, broadcast.",
    ],
    [
      "a session-name line that opens the message, with no tag",
      "You are image-trust-writer; your session name is image-trust-writer.",
    ],
  ])("reads a message with %s as a brief", (_name, text) => {
    expect(isOrchestratorBrief(text)).toBe(true);
  });

  it("reads the prefix `session send` adds as a brief, so a follow-up is never an owner correction", () => {
    expect(isOrchestratorBrief(`${FOLLOW_UP_PREFIX} Stop and rebase`)).toBe(
      true,
    );
  });

  it.each([
    ["a person's correction", "Stop editing the widget manifests directly"],
    [
      "a person's words that say the session name is something else",
      "You are wrong; your session name is not what I asked for.",
    ],
    [
      "a person who names the tag mid-sentence",
      "Stop letting the [orchestrator] brief edit manifests",
    ],
    [
      "a message that only mentions the orchestrator",
      "Ask the orchestrator first",
    ],
  ])("does not read %s as a brief", (_name, text) => {
    expect(isOrchestratorBrief(text)).toBe(false);
  });
});

describe("parseTranscript", () => {
  it("keeps each event's 1-based line and counts the lines it cannot use", () => {
    const text = '{"type":"user"}\n\nnot json\n7\n{"type":"assistant"}\n';
    expect(parseTranscript("s", text)).toEqual({
      id: "s",
      events: [
        { type: "user", line: 1 },
        { type: "assistant", line: 5 },
      ],
      skipped: 2,
    });
  });
});

describe("summarizeError", () => {
  it("replaces quoted text, paths, globs and numbers with placeholders", () => {
    expect(
      summarizeError(
        "<tool_use_error>Error: cannot open '/w/a.txt' in 3 files: *.md</tool_use_error>",
      ),
    ).toBe("Error: cannot open <q> in N files: <glob>");
  });

  it("keeps the exit code and the first shell error line after it", () => {
    expect(
      summarizeError(
        "Exit code 1\nsome stdout\nzsh: no such file or directory: /x/y",
      ),
    ).toBe("Exit code 1: zsh: no such file or directory: <path>");
  });

  it("keeps only the exit code when no error line follows it", () => {
    expect(summarizeError("Exit code 2\nfine output")).toBe("Exit code 2");
  });

  it("truncates the summary to 120 characters", () => {
    expect(summarizeError("x".repeat(200))).toHaveLength(120);
  });
});

describe("transcript blocks", () => {
  it("lists the content blocks of a message, and none for text content", () => {
    expect(
      blocksOf({ line: 1, message: { content: [{ type: "text" }] } }),
    ).toEqual([{ type: "text" }]);
    expect(blocksOf({ line: 1, message: { content: "hi" } })).toEqual([]);
  });

  it("reads a tool result's text: a string as is, a list joined by newlines", () => {
    expect(resultText({ content: "ok" })).toBe("ok");
    expect(resultText({ content: [{ text: "a" }, null, {}] })).toBe("a\n\n");
    expect(resultText({ content: 5 })).toBe("");
  });

  it("keys a call by its command, else its edit text, else its whole input", () => {
    expect(callSignature({ command: "ls" })).toBe('"ls"');
    expect(callSignature({ new_string: "x" })).toBe('"x"');
    expect(callSignature({ path: "a" })).toBe('{"path":"a"}');
    expect(callSignature()).toBe("{}");
  });
});

describe("humanText", () => {
  it("reads a person's typed text, from a text block or a plain string", () => {
    expect(
      humanText({
        line: 1,
        type: "user",
        message: { content: [{ type: "text", text: "please stop that" }] },
      }),
    ).toBe("please stop that");
    expect(
      humanText({ line: 2, type: "user", message: { content: "hello there" } }),
    ).toBe("hello there");
  });

  it.each([
    [
      "a tool result",
      { type: "user", message: { content: [{ type: "tool_result" }] } },
    ],
    [
      "a sidechain message",
      { type: "user", isSidechain: true, message: { content: "x" } },
    ],
    [
      "a meta message",
      { type: "user", isMeta: true, message: { content: "x" } },
    ],
    [
      "a compact summary",
      { type: "user", isCompactSummary: true, message: { content: "x" } },
    ],
    [
      "a message from another origin",
      { type: "user", origin: { kind: "task" }, message: { content: "do it" } },
    ],
    [
      "an injected command",
      {
        type: "user",
        message: { content: "<command-name>/retro</command-name>" },
      },
    ],
    ["an assistant message", { type: "assistant", message: { content: "x" } }],
  ])("returns null for %s", (_name, event) => {
    expect(humanText({ line: 1, ...event })).toBeNull();
  });
});

describe("ownWords", () => {
  it("drops pasted content and system reminders, keeping the person's words", () => {
    expect(
      ownWords(
        'Keep <pasted_content id="a">x y</pasted_content> this <system-reminder>z</system-reminder> words',
      ),
    ).toBe("Keep   this   words");
  });
});

describe("phrasesOf", () => {
  it("splits into lowercase phrases of four or more words, without apostrophes", () => {
    expect(
      phrasesOf(
        "Don't do that. Ok. Stop editing the widget manifests directly!",
      ),
    ).toEqual(["stop editing the widget manifests directly"]);
  });
});

describe("readsAsCorrection", () => {
  it.each([
    ["Don't do that", true],
    ["Looks good to me", false],
  ])("reads %j as a correction: %s", (text, expected) => {
    expect(readsAsCorrection(text)).toBe(expected);
  });
});

describe("timestamps", () => {
  it("reports the earliest and latest stamps, ignoring events without one", () => {
    expect(
      timestamps({
        id: "s",
        skipped: 0,
        events: [
          { line: 1, timestamp: "2026-11-03T00:02:00.000Z" },
          { line: 2 },
          { line: 3, timestamp: "2026-11-03T00:01:00.000Z" },
        ],
      }),
    ).toEqual({
      first: "2026-11-03T00:01:00.000Z",
      last: "2026-11-03T00:02:00.000Z",
    });
  });

  it("reports nulls for a session with no stamps", () => {
    expect(timestamps({ id: "s", skipped: 0, events: [] })).toEqual({
      first: null,
      last: null,
    });
  });
});
