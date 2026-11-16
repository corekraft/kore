import type { Kind } from "./schema.js";

const RESULT_KINDS: readonly Kind[] = ["session.result", "pane.finished"];

/**
 * The outcome word a spawned session printed on its RESULT line, and nothing
 * else: a finish records the word, never the text around it (#853).
 */
export const RESULT_RULES = [
  {
    field: "result",
    check: (v: unknown) => v === "done" || v === "blocked",
    hint: "must be one of done, blocked",
    kinds: RESULT_KINDS,
  },
] as const;
