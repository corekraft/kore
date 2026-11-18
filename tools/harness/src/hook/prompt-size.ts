// A session's latest prompt size against the compaction cap (#1038): the report, its one text
// line, and its JSON form. The prompt is read by the split reader the stop hook uses
// (hook/feedback-split.ts), so the definition of a prompt stays in one place. This file decides
// only over and not over, and prints numbers and the session name, never transcript text.

import { advanceSplit, EMPTY_SPLIT } from "./feedback-split.js";

/** One session's latest prompt. `cap` and `over` are null when no compaction cap is set. */
export interface PromptSize {
  session: string;
  prompt: number;
  cap: number | null;
  over: boolean | null;
}

/**
 * The latest request's prompt of a transcript against the cap; a prompt equal to the cap is not
 * over it. Undefined when no request in the transcript carries usage yet, never a size of zero.
 */
export function promptSizeOf(
  session: string,
  transcript: string,
  cap: number | undefined,
): PromptSize | undefined {
  const latest = advanceSplit(EMPTY_SPLIT, transcript, cap).last;
  if (latest === undefined) {
    return undefined;
  }
  return {
    session,
    prompt: latest.prompt,
    cap: cap ?? null,
    over: cap === undefined ? null : latest.prompt > cap,
  };
}

/** The report as one text line: the session, the prompt, and the cap with over or not over, or not set. */
export function promptLineOf(size: PromptSize): string {
  const cap =
    size.cap === null
      ? "cap not set"
      : `cap ${size.cap}, ${size.over === true ? "over" : "not over"}`;
  return `session ${size.session}: prompt ${size.prompt}, ${cap}\n`;
}

/** The same fields as the line, as one JSON object: cap and over are null when no cap is set. */
export function promptJsonOf(size: PromptSize): string {
  return `${JSON.stringify({
    session: size.session,
    prompt: size.prompt,
    cap: size.cap,
    over: size.over,
  })}\n`;
}
