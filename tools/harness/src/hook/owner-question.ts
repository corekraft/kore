// Whether a turn ended waiting on the owner (#859, parent #820). Pure: it reads
// the transcript text a Stop hook was handed and returns a yes or a no. No text
// leaves this module.

interface AssistantEntry {
  id: string;
  content: unknown[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** An assistant line with its message id and content blocks; anything else is left out. */
function assistantOf(line: string): AssistantEntry | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    // A line that is not JSON is not an assistant message.
    return undefined;
  }
  if (!isObject(value) || value["type"] !== "assistant") {
    return undefined;
  }
  const message = value["message"];
  if (!isObject(message) || typeof message["id"] !== "string") {
    return undefined;
  }
  const content = message["content"];
  return {
    id: message["id"],
    content: Array.isArray(content) ? content : [],
  };
}

/** The text of the text blocks in one assistant entry's content. */
function textOf(content: unknown[]): string[] {
  return content.flatMap((block) =>
    isObject(block) &&
    block["type"] === "text" &&
    typeof block["text"] === "string"
      ? [block["text"]]
      : [],
  );
}

/**
 * Whether the transcript's final assistant message ends with a question. A
 * message streams as several lines that share one id, so the text is read
 * from all of them; a message with no text (only a tool call) asks nothing.
 */
export function asksOwner(transcript: string): boolean {
  const entries = transcript.split("\n").flatMap((line) => {
    const entry = assistantOf(line);
    return entry === undefined ? [] : [entry];
  });
  const last = entries.at(-1);
  if (last === undefined) {
    return false;
  }
  const text = entries
    .filter((entry) => entry.id === last.id)
    .flatMap((entry) => textOf(entry.content))
    .join("\n");
  return text.trimEnd().endsWith("?");
}
