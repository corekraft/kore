import type { Kind } from "./schema.js";

const RESULT_KINDS: readonly Kind[] = ["session.result", "pane.finished"];
const TOOL_START_KINDS: readonly Kind[] = ["tool.start"];

/**
 * The background mark on a tool.start whose command runs in the background (#854).
 * Absent on every foreground call, so the mark is optional and only true when present.
 */
export const BACKGROUND_RULES = [
  {
    field: "background",
    check: (v: unknown) => v === true,
    hint: "must be true when present",
    kinds: TOOL_START_KINDS,
    optional: true,
  },
] as const;

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
