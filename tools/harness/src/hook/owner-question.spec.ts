import { describe, expect, it } from "vitest";
import { asksOwner } from "./owner-question.js";

/** One transcript line, as Claude Code writes it: an assistant message with content blocks, or any other entry. */
const assistant = (id: string, content: unknown[]) =>
  JSON.stringify({ type: "assistant", message: { id, content } });
const text = (value: string) => ({ type: "text", text: value });
const toolUse = (name: string) => ({
  type: "tool_use",
  name,
  input: {},
});
const user = (value: string) =>
  JSON.stringify({ type: "user", message: { content: value } });

describe("owner question detection: a turn that ends waiting on the owner", () => {
  it("counts a turn whose final message ends with a question", () => {
    const transcript = assistant("m1", [text("Which branch should I use?")]);

    expect(asksOwner(transcript)).toBe(true);
  });

  it("counts a final message whose question is followed by only whitespace", () => {
    const transcript = assistant("m1", [text("Proceed with the merge?\n  ")]);

    expect(asksOwner(transcript)).toBe(true);
  });

  it("does not count a turn that ends in a statement, even when a question came before it", () => {
    const transcript = assistant("m1", [
      text("Should I rebase? Done. Tests pass."),
    ]);

    expect(asksOwner(transcript)).toBe(false);
  });

  it("reads the text of a streamed message whose blocks arrive on several lines", () => {
    const transcript = [
      assistant("m1", [text("Which branch should I use?")]),
      assistant("m1", [toolUse("AskUserQuestion")]),
    ].join("\n");

    expect(asksOwner(transcript)).toBe(true);
  });

  it("looks only at the final message of the turn, not an earlier question", () => {
    const transcript = [
      assistant("m1", [text("Proceed?")]),
      user("yes"),
      assistant("m2", [text("Merged. Nothing else is needed.")]),
    ].join("\n");

    expect(asksOwner(transcript)).toBe(false);
  });

  it("does not count a final message that only calls a tool and says nothing", () => {
    const transcript = assistant("m1", [toolUse("Bash")]);

    expect(asksOwner(transcript)).toBe(false);
  });

  it("does not count a transcript with no assistant message", () => {
    expect(asksOwner(user("hello?"))).toBe(false);
    expect(asksOwner("")).toBe(false);
  });

  it("skips a line that is not JSON and reads the assistant message after it", () => {
    const transcript = [
      "not json at all",
      assistant("m1", [text("Ready?")]),
    ].join("\n");

    expect(asksOwner(transcript)).toBe(true);
  });
});
