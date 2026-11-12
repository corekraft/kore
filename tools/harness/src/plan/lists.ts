// Edits to a plan's "Where each open item can be done" section: drop a ticked
// item from its list entry, lower the entry's count and the class totals.

import { trimCommon, type Edit } from "./edits.js";
import { totalsEdits } from "./totals.js";

export type ListEdits = { edits: Edit[] } | { error: string };

const SECTION = "## Where each open item can be done";
const HEADER = /^- (.+?) \((\d+)\): /;
const LEAD = /^and (\w+)(\s+)exit(\s+)(?:criterion|criteria):(\s+)/;
const NUMBERS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];
const MIN_SCORE = 0.6;
/** A runner-up this close to the best segment makes the placement a guess. */
const MARGIN = 0.15;

interface Entry {
  start: number;
  end: number;
  step: string;
  raw: string;
}

interface Segment {
  /** Offsets into the entry's raw text, trimmed of surrounding whitespace. */
  start: number;
  end: number;
  /** Where the item text begins, after any exit-criteria lead. */
  itemStart: number;
  exit: boolean;
}

function sectionRange(lines: string[]): [number, number] | null {
  const start = lines.indexOf(SECTION);
  if (start < 0) {
    return null;
  }
  const next = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  return [start, next < 0 ? lines.length : next];
}

function entriesIn(lines: string[], from: number, to: number): Entry[] {
  const entries: Entry[] = [];
  for (let i = from; i < to; i++) {
    const line = lines[i] ?? "";
    const step = HEADER.exec(line)?.[1];
    if (step === undefined) {
      continue;
    }
    let end = i + 1;
    while (end < to && /^\s+\S/.test(lines[end] ?? "")) {
      end++;
    }
    entries.push({
      start: i,
      end,
      step,
      raw: lines.slice(i, end).join("\n"),
    });
    i = end - 1;
  }
  return entries;
}

function segmentsOf(raw: string): Segment[] {
  const bodyStart = HEADER.exec(raw)?.[0].length ?? 0;
  const trimmed = raw.trimEnd();
  const bodyEnd = trimmed.endsWith(".") ? trimmed.length - 1 : trimmed.length;
  const pieces: [number, number][] = [];
  let depth = 0;
  let from = bodyStart;
  for (let i = bodyStart; i < bodyEnd; i++) {
    const c = raw[i];
    if (c === "(") {
      depth++;
    } else if (c === ")") {
      depth--;
    }
    if (c === ";" && depth === 0) {
      pieces.push([from, i]);
      from = i + 1;
    }
  }
  pieces.push([from, bodyEnd]);
  let exit = false;
  return pieces.map(([a, b]) => {
    const text = raw.slice(a, b);
    const start = a + (text.length - text.trimStart().length);
    const end = b - (text.length - text.trimEnd().length);
    const lead = LEAD.exec(raw.slice(start, end))?.[0];
    exit ||= lead !== undefined;
    return { start, end, itemStart: start + (lead?.length ?? 0), exit };
  });
}

function words(text: string): Set<string> {
  return new Set(
    (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length >= 4),
  );
}

function score(item: Set<string>, segment: string): number {
  const own = words(segment.replace(/\([^)]*\)/g, " "));
  if (own.size === 0) {
    return 0;
  }
  return [...own].filter((w) => item.has(w)).length / own.size;
}

function lowered(raw: string, segment: Segment): string {
  const lead = LEAD.exec(raw.slice(segment.start, segment.end));
  if (lead === null) {
    return raw;
  }
  const word = lead[1] ?? "";
  const parsed = /^\d+$/.test(word) ? Number(word) : NUMBERS.indexOf(word);
  if (parsed < 1) {
    return raw;
  }
  const count = parsed - 1;
  const shown = /^\d+$/.test(word) ? String(count) : (NUMBERS[count] ?? word);
  const noun = count === 1 ? "criterion" : "criteria";
  const [, , gap1, gap2, gap3] = lead;
  const text = `and ${shown}${gap1}exit${gap2}${noun}:${gap3}`;
  return (
    raw.slice(0, segment.start) +
    text +
    raw.slice(segment.start + lead[0].length)
  );
}

/**
 * The parenthetical note that also speaks for the segment at `index`: "both"
 * covers the noted segment and the one before it, "all" every segment.
 */
function sharedNote(
  raw: string,
  segments: Segment[],
  index: number,
): string | undefined {
  for (const [i, segment] of segments.entries()) {
    const text = raw.slice(segment.itemStart, segment.end);
    const note = /\([^)]*\b(both|all)\b[^)]*\)/i.exec(text);
    const covered =
      note?.[1]?.toLowerCase() === "all" || index === i || index === i - 1;
    if (note !== null && covered) {
      return note[0];
    }
  }
  return undefined;
}

/** The entry's text without the segment at `index`, or null when it was the only one. */
function without(
  raw: string,
  segments: Segment[],
  index: number,
): string | null {
  const target = segments[index];
  if (target === undefined || segments.length === 1) {
    return null;
  }
  const next = segments[index + 1];
  const previous = segments[index - 1];
  const [from, to] =
    next === undefined
      ? [previous?.end ?? 0, target.end]
      : [target.itemStart, next.start];
  const cut = raw.slice(0, from) + raw.slice(to);
  const lead = segments.find((s) => s.exit);
  const others = segments.filter((s) => s.exit && s !== target).length;
  return target.exit && lead !== undefined && others > 0
    ? lowered(cut, lead)
    : cut;
}

function classOf(lines: string[], entry: Entry, from: number): string {
  for (let i = entry.start; i >= from; i--) {
    const heading = /^### (.+)$/.exec(lines[i] ?? "")?.[1];
    if (heading !== undefined) {
      return heading;
    }
  }
  return "";
}

interface Placement {
  entry: Entry;
  all: Segment[];
  index: number;
  score: number;
}

/** The one segment of `entries` the item belongs to, or an error when it is a guess. */
function locate(
  entries: Entry[],
  step: string,
  itemText: string,
): Placement | { error: string } {
  const item = words(itemText);
  const scored: Placement[] = entries.flatMap((entry) =>
    segmentsOf(entry.raw).map((segment, index, all) => ({
      entry,
      all,
      index,
      score: score(item, entry.raw.slice(segment.itemStart, segment.end)),
    })),
  );
  scored.sort((a, b) => b.score - a.score);
  const [best, runnerUp] = scored;
  const close =
    runnerUp !== undefined &&
    runnerUp.score >= MIN_SCORE &&
    (best?.score ?? 0) - runnerUp.score <= MARGIN;
  if (best === undefined || best.score < MIN_SCORE || close) {
    return {
      error: `Cannot tell which list entry under ${step} holds this item. Reword the list entry to share words with the item, or tick it by hand.`,
    };
  }
  return best;
}

/**
 * Edits that remove the ticked item from its list entry and recount. The
 * item is located by word overlap, because list entries abbreviate the plan's
 * wording. No edits when the plan has no such section.
 */
export function listEdits(
  lines: string[],
  step: string,
  itemText: string,
  date: string,
): ListEdits {
  const range = sectionRange(lines);
  if (range === null) {
    return { edits: [] };
  }
  const entries = entriesIn(lines, range[0], range[1]).filter(
    (e) => e.step === step,
  );
  if (entries.length === 0) {
    return {
      error: `The open-item lists have no entry for ${step}. Add the item to its list, or tick it by hand.`,
    };
  }
  const best = locate(entries, step, itemText);
  if ("error" in best) {
    return best;
  }
  const shared = sharedNote(best.entry.raw, best.all, best.index);
  if (shared !== undefined) {
    return {
      error: `The note ${shared} in the ${step} list entry covers more than one item, so removing this one would leave it wrong. Edit the entry by hand, or reword the note.`,
    };
  }
  const rest = without(best.entry.raw, best.all, best.index);
  const replaced =
    rest === null
      ? []
      : rest
          .replace(
            /^(- .+? \()(\d+)(\): )/,
            (_, a, n, c) => `${a}${Number(n) - 1}${c}`,
          )
          .split("\n");
  const entryEdit = trimCommon(
    { start: best.entry.start, end: best.entry.end, lines: replaced },
    lines,
  );
  const totals = totalsEdits(
    lines,
    range,
    classOf(lines, best.entry, range[0]),
    date,
  );
  if (typeof totals === "string") {
    return { error: totals };
  }
  return { edits: [...(entryEdit === null ? [] : [entryEdit]), ...totals] };
}
