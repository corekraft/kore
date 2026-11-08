import { isSensitiveName, redactionMarker } from "../runtime/index.js";

const entry = /^(\s*(?:-\s+)?)([A-Za-z0-9_.-]+):(?:[ \t]+(\S.*))?$/;
const secretKind = /^kind:\s*Secret\s*$/m;
const secretBlock = /^(\s*)(?:data|stringData):\s*(\S.*)?$/;
// References to secrets (not values) and the bare `key` of a remote reference.
const reference = /^(?:key|.*(?:name|ref|store|namespace|enabled))$/i;

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function isBlank(line: string): boolean {
  return line.trim() === "";
}

/** Index of the first line after `start` that is not nested deeper than `indent`. */
function endOfNested(lines: string[], start: number, indent: number): number {
  let index = start;
  while (
    index < lines.length &&
    (isBlank(lines[index]!) || indentOf(lines[index]!) > indent)
  ) {
    index++;
  }
  return index;
}

function redactSecretBlock(
  lines: string[],
  start: number,
  indent: number,
  out: string[],
): number {
  const end = endOfNested(lines, start, indent);
  let childIndent = -1;
  for (let index = start; index < end; index++) {
    const line = lines[index]!;
    if (isBlank(line)) {
      continue;
    }
    childIndent = childIndent < 0 ? indentOf(line) : childIndent;
    const match = entry.exec(line);
    if (match && indentOf(line) === childIndent) {
      out.push(`${match[1]}${match[2]}: ${redactionMarker}`);
    }
  }
  return end;
}

function redactDocument(document: string): string {
  const lines = document.split("\n");
  const isSecret = secretKind.test(document);
  const out: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    const block = isSecret ? secretBlock.exec(line) : null;
    if (block) {
      const indent = block[1]!.length;
      if (block[2]) {
        out.push(`${block[1]}${line.trim().split(":")[0]}: ${redactionMarker}`);
        index++;
      } else {
        out.push(line);
        index = redactSecretBlock(lines, index + 1, indent, out);
      }
      continue;
    }
    const match = entry.exec(line);
    if (
      match?.[3] &&
      isSensitiveName(match[2]!) &&
      !reference.test(match[2]!)
    ) {
      out.push(`${match[1]}${match[2]}: ${redactionMarker}`);
      const nested = /^[|>]/.test(match[3])
        ? endOfNested(lines, index + 1, indentOf(line))
        : index + 1;
      index = nested;
      continue;
    }
    out.push(line);
    index++;
  }
  return out.join("\n");
}

/**
 * Hides Secret data/stringData values and values under known sensitive keys in
 * rendered YAML, so output written to disk never reveals a secret. Keys and
 * structure stay readable.
 */
export function redactManifest(manifest: string): string {
  return manifest
    .split(/^(---\s*)$/m)
    .map((part) => (/^---\s*$/.test(part) ? part : redactDocument(part)))
    .join("");
}
