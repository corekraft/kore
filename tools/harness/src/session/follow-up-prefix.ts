/**
 * The tag a follow-up carries so the retro scan never counts it as an owner correction.
 * Named after the tag, not a role. It keeps the literal text so past transcripts still parse.
 */
export const FOLLOW_UP_PREFIX = "[orchestrator]";

/** The message with the prefix once, whether or not the caller already typed it. */
export function withFollowUpPrefix(message: string): string {
  const trimmed = message.trim();
  const head = trimmed.slice(0, FOLLOW_UP_PREFIX.length);
  const body =
    head.toLowerCase() === FOLLOW_UP_PREFIX
      ? trimmed.slice(FOLLOW_UP_PREFIX.length).trim()
      : trimmed;
  return `${FOLLOW_UP_PREFIX} ${body}`;
}
