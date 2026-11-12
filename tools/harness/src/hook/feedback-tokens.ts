import type { FileSystem } from "../runtime/index.js";

/**
 * Tokens a session has used so far, from its transcript (JSONL): input, output
 * and cache-creation tokens of each assistant message, counted once per message
 * id (a message repeats as it streams; the last copy wins). Cache reads are left
 * out, since they re-count the same context every turn. Only numbers are read;
 * no text leaves this function.
 */
export function transcriptTokens(text: string): number {
  const byMessage = new Map<string, number>();
  text.split("\n").forEach((raw, index) => {
    try {
      const value = JSON.parse(raw) as {
        type?: unknown;
        message?: { id?: unknown; usage?: Record<string, unknown> };
      };
      const usage = value.message?.usage;
      if (value.type !== "assistant" || usage === undefined) {
        return;
      }
      const count = (key: string) => {
        const n = usage[key];
        return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
      };
      const id =
        typeof value.message?.id === "string"
          ? value.message.id
          : `line-${index}`;
      byMessage.set(
        id,
        count("input_tokens") +
          count("output_tokens") +
          count("cache_creation_input_tokens"),
      );
    } catch {
      // A line that is not JSON carries no usage.
    }
  });
  return [...byMessage.values()].reduce((sum, n) => sum + n, 0);
}

/** The transcript's tokens; 0 when the path is missing or unreadable, since usage is best effort. */
export async function readTokens(
  fs: FileSystem,
  path: unknown,
): Promise<number> {
  try {
    return typeof path === "string" && path !== ""
      ? transcriptTokens(await fs.readFile(path))
      : 0;
  } catch {
    return 0;
  }
}
