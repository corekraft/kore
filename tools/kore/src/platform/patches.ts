import type { ProbePatch } from "../config/index.js";

// Docs: docs/decisions/0088-declarative-probe-patches-through-a-helm-post-renderer.md

/**
 * Declarative probe patches for charts that give no value for a probe field.
 * The catalog lists them; a Helm post-renderer applies them to the rendered
 * manifest stream, so `helm template` and `helm upgrade` see the same output.
 * Only integer fields of a probe the chart already renders are set, and a
 * target that is missing fails loudly: a chart bump must not drop a patch.
 *
 * The stream is edited as text because the CLI uses only the Node standard
 * library, which has no YAML parser. Helm renders block-style YAML; a probe
 * written in flow style (`livenessProbe: {...}`) is refused, not guessed at.
 */

export type { ProbePatch };

const probeNames = ["livenessProbe", "readinessProbe", "startupProbe"] as const;
type ProbeName = (typeof probeNames)[number];

const indentOf = (line: string) => line.length - line.trimStart().length;
const blank = (line: string) => line.trim() === "";
const unquote = (value: string) => value.trim().replace(/^["']|["']$/g, "");

function describe(patch: ProbePatch): string {
  const { kind, name, container } = patch.target;
  return `${kind}/${name} container ${container}`;
}

/** The kind and name of a document, from block or flow style metadata. */
function identity(doc: string[]): { kind?: string; name?: string } {
  const kind = doc.map((l) => /^kind:\s*(\S+)/.exec(l)?.[1]).find(Boolean);
  const at = doc.findIndex((l) => l.startsWith("metadata:"));
  if (at < 0) {
    return kind ? { kind } : {};
  }
  const flow = /^metadata:\s*\{.*?\bname:\s*([^,}\s]+)/.exec(doc[at]!)?.[1];
  const block = doc
    .slice(at + 1)
    .find((l) => !blank(l) && /^ {2}name:\s*\S/.test(l));
  const raw = flow ?? /name:\s*(\S+)/.exec(block ?? "")?.[1];
  return {
    ...(kind ? { kind } : {}),
    ...(raw ? { name: unquote(raw) } : {}),
  };
}

/** Index ranges [start, end) of each container item under `containers:`. */
function containerItems(doc: string[]): [number, number][] {
  const at = doc.findIndex((l) => /^\s*containers:\s*$/.test(l));
  if (at < 0) {
    return [];
  }
  const first = doc.findIndex((l, i) => i > at && !blank(l));
  if (first < 0 || !doc[first]!.trimStart().startsWith("- ")) {
    return [];
  }
  const dash = indentOf(doc[first]!);
  const items: [number, number][] = [];
  let start = first;
  for (let i = first + 1; i <= doc.length; i += 1) {
    const line = doc[i];
    if (line !== undefined && (blank(line) || indentOf(line) > dash)) {
      continue;
    }
    items.push([start, i]);
    if (
      line === undefined ||
      indentOf(line) < dash ||
      !line.trimStart().startsWith("- ")
    ) {
      break;
    }
    start = i;
  }
  return items;
}

/** The text of a line as a key of the item (the dash line counts as indented). */
function keyText(
  item: string[],
  index: number,
  dash: number,
): string | undefined {
  const line = item[index]!;
  if (index === 0) {
    return line.slice(dash + 2);
  }
  return indentOf(line) === dash + 2 ? line.slice(dash + 2) : undefined;
}

function setFields(
  item: string[],
  probe: ProbeName,
  fields: Record<string, number>,
  dash: number,
  label: string,
): void {
  const at = item.findIndex((_, i) => keyText(item, i, dash) === `${probe}:`);
  if (at < 0) {
    throw new Error(`patch target ${label} has no ${probe}`);
  }
  let end = at + 1;
  let last = at;
  while (
    end < item.length &&
    (blank(item[end]!) || indentOf(item[end]!) > dash + 2)
  ) {
    if (!blank(item[end]!)) {
      last = end;
    }
    end += 1;
  }
  if (last === at) {
    throw new Error(`patch target ${label} ${probe} is not a block mapping`);
  }
  const child = indentOf(item[at + 1]!);
  for (const [field, value] of Object.entries(fields)) {
    const line = `${" ".repeat(child)}${field}: ${value}`;
    const existing = item.findIndex(
      (l, i) =>
        i > at &&
        i <= last &&
        indentOf(l) === child &&
        l.trimStart().startsWith(`${field}:`),
    );
    if (existing >= 0) {
      item[existing] = line;
    } else {
      item.splice(last + 1, 0, line);
      last += 1;
    }
  }
}

function patchDocument(doc: string[], patch: ProbePatch): boolean {
  const { kind, name } = identity(doc);
  if (kind !== patch.target.kind || name !== patch.target.name) {
    return false;
  }
  for (const [start, end] of containerItems(doc)) {
    const item = doc.slice(start, end);
    const dash = indentOf(item[0]!);
    const own = item
      .map((_, i) => /^name:\s*(.+)$/.exec(keyText(item, i, dash) ?? "")?.[1])
      .find(Boolean);
    if (own === undefined || unquote(own) !== patch.target.container) {
      continue;
    }
    for (const probe of probeNames) {
      const fields = patch.probes[probe];
      if (fields) {
        setFields(item, probe, fields, dash, describe(patch));
      }
    }
    doc.splice(start, end - start, ...item);
    return true;
  }
  return false;
}

/** Applies every patch to the rendered manifest stream. */
export function applyProbePatches(
  stream: string,
  patches: ProbePatch[],
): string {
  if (patches.length === 0) {
    return stream;
  }
  const lines = stream.split("\n");
  const found = new Set<ProbePatch>();
  let start = 0;
  for (let i = 0; i <= lines.length; i += 1) {
    if (i < lines.length && lines[i] !== "---") {
      continue;
    }
    const doc = lines.slice(start, i);
    for (const patch of patches) {
      if (patchDocument(doc, patch)) {
        found.add(patch);
      }
    }
    lines.splice(start, i - start, ...doc);
    i = start + doc.length;
    start = i + 1;
  }
  const missing = patches.find((patch) => !found.has(patch));
  if (missing) {
    throw new Error(
      `patch target ${describe(missing)} not found in the rendered chart; update the catalog patches for the chart version`,
    );
  }
  return lines.join("\n");
}
