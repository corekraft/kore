import type { Edit } from "./edits.js";

const TOTALS =
  /as of \d{4}-\d{2}-\d{2}: (\d+) local, (\d+) managed(\s+)cluster, (\d+) release(\s+)pipeline/;

export function totalsEdits(
  lines: string[],
  range: [number, number],
  className: string,
  date: string,
): Edit[] | string {
  const firstClass = lines.findIndex(
    (l, i) => i > range[0] && i < range[1] && l.startsWith("### "),
  );
  const introEnd = firstClass < 0 ? range[1] : firstClass;
  const intro = lines.slice(range[0], introEnd).join("\n");
  const match = TOTALS.exec(intro);
  if (match === null) {
    return /\bas of\b/.test(intro)
      ? "The open-item totals line is not in the form `as of YYYY-MM-DD: N local, N managed cluster, N release pipeline`, so it cannot be recounted. Fix its wording, or tick the item by hand."
      : [];
  }
  const lower = className.toLowerCase();
  if (!["local", "managed", "release"].some((c) => lower.startsWith(c))) {
    return `The list class "${className}" is not Local, Managed cluster or Release pipeline, so the totals cannot be recounted. Rename the heading, or tick the item by hand.`;
  }
  const [local, managed, release] = [match[1], match[2], match[4]].map(
    Number,
  ) as [number, number, number];
  const next = {
    local: local - (lower.startsWith("local") ? 1 : 0),
    managed: managed - (lower.startsWith("managed") ? 1 : 0),
    release: release - (lower.startsWith("release") ? 1 : 0),
  };
  const text =
    `as of ${date}: ${next.local} local, ${next.managed} managed${match[3]}` +
    `cluster, ${next.release} release${match[5]}pipeline`;
  const changed = intro.replace(TOTALS, text).split("\n");
  const before = intro.split("\n");
  const edits: Edit[] = [];
  for (const [i, line] of changed.entries()) {
    if (line !== before[i]) {
      edits.push({ start: range[0] + i, end: range[0] + i + 1, lines: [line] });
    }
  }
  return edits;
}
