// Reading one session transcript (JSONL) for the retrospective scan: parsing,
// error summaries, and the user's own words. Never keeps assistant text.
// Docs: infra/plans/5-self-maintenance.md#step-2-deterministic-retrospective-scan

const MAX_ERROR = 120;
const MIN_CORRECTION_WORDS = 4;

export interface Block {
  type?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  is_error?: boolean;
  content?: unknown;
  text?: string;
}

export interface TranscriptEvent {
  line: number;
  type?: string;
  timestamp?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  isCompactSummary?: boolean;
  origin?: { kind?: string };
  message?: { content?: unknown };
  attachment?: { type?: string; content?: unknown; toolUseID?: string };
}

export interface Transcript {
  id: string;
  events: TranscriptEvent[];
  skipped: number;
}

/** Parse JSONL, keeping the 1-based line number; malformed lines are counted. */
export function parseTranscript(id: string, text: string): Transcript {
  const events: TranscriptEvent[] = [];
  let skipped = 0;
  text.split("\n").forEach((raw, index) => {
    if (raw.trim() === "") {
      return;
    }
    try {
      const value = JSON.parse(raw) as unknown;
      if (value === null || typeof value !== "object") {
        throw new Error("not an object");
      }
      events.push({ ...value, line: index + 1 });
    } catch {
      skipped++;
    }
  });
  return { id, events, skipped };
}

const ERROR_WORDS =
  /\b(errors?|fail(ed|ure|ures)?|fatal|not found|no such|denied|cannot|invalid|refused|no matches)\b/i;
const SHELL_PREFIX = /^(\(eval\):\d+:|zsh:|bash:|sh:)/;
const NOT_OUTPUT_ERROR = /^(- |#|import |export |\|)/;

/** Whether a line of command output reads as an error rather than stdout, Markdown, or code. */
const looksLikeError = (line: string): boolean =>
  !NOT_OUTPUT_ERROR.test(line) &&
  (ERROR_WORDS.test(line) || SHELL_PREFIX.test(line));

/**
 * Reduce an error to a stable, short summary: the first line (plus a shell
 * error line after an exit code), with paths, quoted text, globs, and numbers
 * replaced by placeholders.
 */
export function summarizeError(text: string): string {
  const lines = text
    .replace(/<\/?tool_use_error>/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  let head = lines[0] ?? "";
  let prefix = "";
  if (/^Exit code \d+$/.test(head)) {
    prefix = head;
    head = lines.slice(1).find(looksLikeError) ?? "";
  }
  const normalized = head
    .replace(/'[^']*'|"[^"]*"/g, "<q>")
    .replace(/(^|[\s(=])\/[^\s)]*/g, "$1<path>")
    .replace(/(^|\s)\S*\*\S*/g, "$1<glob>")
    .replace(/\b\d+\b/g, "N");
  const joined =
    prefix && normalized ? `${prefix}: ${normalized}` : prefix || normalized;
  return joined.slice(0, MAX_ERROR);
}

export const blocksOf = (event: TranscriptEvent): Block[] =>
  Array.isArray(event.message?.content)
    ? (event.message.content as Block[])
    : [];

export function resultText(block: Block): string {
  const { content } = block;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return (content as ({ text?: string } | null)[])
      .map((part) => part?.text ?? "")
      .join("\n");
  }
  return "";
}

/** What identifies a tool call's argument: its command or edit text, else the whole input. */
export const callSignature = (input: Record<string, unknown> = {}): string =>
  JSON.stringify(
    input["command"] ?? input["new_string"] ?? input["content"] ?? input,
  );

const INJECTED = /^\s*<(command-|local-command|task-notification)/;

function typedText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return (content as Block[])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

/** The user's own typed text, or null for tool results, commands, and injected text. */
export function humanText(event: TranscriptEvent): string | null {
  const notTyped =
    event.type !== "user" ||
    event.isSidechain ||
    event.isMeta ||
    event.isCompactSummary;
  if (notTyped || (event.origin && event.origin.kind !== "human")) {
    return null;
  }
  const text = typedText(event.message?.content);
  return text.trim() === "" || INJECTED.test(text) ? null : text;
}

const CORRECTION_WORD =
  /\b(no|not|dont|don't|don’t|stop|instead|wrong|again|actually|should|never)\b/i;

export const readsAsCorrection = (text: string): boolean =>
  CORRECTION_WORD.test(text);

/** The user's words without pasted content and injected reminders. */
export const ownWords = (text: string): string =>
  text
    .replace(/<pasted_content[^>]*>[\s\S]*?<\/pasted_content[^>]*>/g, " ")
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, " ");

export const phrasesOf = (text: string): string[] =>
  text
    .split(/[.!?;\n]+/)
    .map((part) =>
      part
        .toLowerCase()
        .replace(/['’`]/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim(),
    )
    .filter((phrase) => phrase.split(" ").length >= MIN_CORRECTION_WORDS);

export function timestamps(session: Transcript): {
  first: string | null;
  last: string | null;
} {
  const stamps = session.events
    .map((event) => event.timestamp)
    .filter((stamp): stamp is string => Boolean(stamp))
    .sort();
  return { first: stamps[0] ?? null, last: stamps.at(-1) ?? null };
}
