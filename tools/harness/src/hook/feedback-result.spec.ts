import { beforeEach, describe, expect, it, vi } from "vitest";
import { findResult } from "../session/index.js";
import { resultOf } from "./feedback-result.js";

vi.mock("../session/index.js", () => ({ findResult: vi.fn() }));

const assistant = (...texts: string[]) =>
  JSON.stringify({
    type: "assistant",
    message: { content: texts.map((text) => ({ type: "text", text })) },
  });
const user = (text: string) =>
  JSON.stringify({ type: "user", message: { content: text } });

beforeEach(() => {
  vi.mocked(findResult).mockReturnValue(undefined);
});

describe("resultOf reads the RESULT line of the turn's assistant text", () => {
  it("passes only the assistant text blocks of the turn to the marker rule, and returns its outcome", () => {
    vi.mocked(findResult).mockReturnValue("done");

    expect(
      resultOf(
        [
          user("RESULT: blocked"),
          assistant("working", "still working"),
          assistant("RESULT: done"),
          "",
        ].join("\n"),
      ),
    ).toBe("done");
    expect(findResult).toHaveBeenCalledExactlyOnceWith(
      "working\nstill working\nRESULT: done",
    );
  });

  it("skips a line that is not JSON, and a tool block that is not text", () => {
    const toolUse = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Bash" }] },
    });

    resultOf(["not json", toolUse, assistant("RESULT: blocked")].join("\n"));

    expect(findResult).toHaveBeenCalledExactlyOnceWith("RESULT: blocked");
  });

  it("reports no result when the turn's text has no RESULT line", () => {
    expect(resultOf(`${assistant("done.")}\n`)).toBeUndefined();
    expect(findResult).toHaveBeenCalledExactlyOnceWith("done.");
  });

  it("reports no result for a turn that added no complete lines", () => {
    expect(resultOf("")).toBeUndefined();
    expect(findResult).toHaveBeenCalledExactlyOnceWith("");
  });
});
