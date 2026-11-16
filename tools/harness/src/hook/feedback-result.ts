// The outcome word a session's Stop hook records as session.result (#853): the RESULT
// line in the assistant text the turn just added to the transcript. Only the word is
// returned; the text is read in memory and dropped.

import { findResult } from "../session/index.js";

/** The text blocks of one transcript line when it is an assistant message; none for any other line. */
function assistantBlocks(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as {
      type?: unknown;
      message?: { content?: unknown };
    };
    const content = value.message?.content;
    if (value.type !== "assistant" || !Array.isArray(content)) {
      return [];
    }
    return (content as { type?: unknown; text?: unknown }[]).flatMap((block) =>
      block.type === "text" && typeof block.text === "string"
        ? [block.text]
        : [],
    );
  } catch {
    // A line that is not JSON carries no assistant text.
    return [];
  }
}

/**
 * The outcome word of the RESULT line in the assistant text of `added`, the complete
 * lines a stop read from the transcript. Only the text blocks of assistant lines count.
 */
export function resultOf(added: string): "done" | "blocked" | undefined {
  return findResult(added.split("\n").flatMap(assistantBlocks).join("\n"));
}
