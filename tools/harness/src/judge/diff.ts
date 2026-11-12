export interface ChangedFile {
  path: string;
  deleted: boolean;
  added: string[];
  removed: number;
}

/** Splits a unified diff into the files it changes, with added lines and a removed-line count. */
export function parseDiff(text: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  let current: ChangedFile | undefined;
  let inHunk = false;
  for (const line of text.split("\n")) {
    const header = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (header?.[2] !== undefined) {
      current = { path: header[2], deleted: false, added: [], removed: 0 };
      files.push(current);
      inHunk = false;
    } else if (current === undefined) {
      continue;
    } else if (line.startsWith("@@")) {
      inHunk = true;
    } else if (!inHunk && line.startsWith("deleted file mode")) {
      current.deleted = true;
    } else if (inHunk && line.startsWith("+")) {
      current.added.push(line.slice(1));
    } else if (inHunk && line.startsWith("-")) {
      current.removed += 1;
    }
  }
  return files;
}
