// Stale documents: plans and ADRs verified before a file they depend on changed.
// Plan: infra/plans/5-self-maintenance.md#step-5-stale-documents

import { ADR, MARKER, PLAN, type TreeDeps } from "./findings.js";
import {
  DATE,
  LINK,
  frontmatter,
  isExternal,
  proseLines,
  resolve,
} from "./markdown.js";

export interface StaleDocument {
  document: string;
  verified: string;
  path: string;
  date: string;
}

/** The tree plus git history: the date (YYYY-MM-DD) of the newest commit that touched a file, or null when it has none. */
export interface HistoryDeps extends TreeDeps {
  commitDate?(path: string): Promise<string | null>;
}

/** The files each plan or ADR links to, or that carry a marker pointing at it. */
function dependenciesOf(deps: TreeDeps): Map<string, Set<string>> {
  const files = [...deps.files()].sort();
  const tracked = new Set(files);
  const dependencies = new Map<string, Set<string>>();
  const depend = (document: string, path: string) => {
    if (path === document || !tracked.has(path)) {
      return;
    }
    let paths = dependencies.get(document);
    if (!paths) {
      paths = new Set();
      dependencies.set(document, paths);
    }
    paths.add(path);
  };
  for (const file of files) {
    const text = deps.read(file);
    if (text === null) {
      continue;
    }
    if (PLAN.test(file) || ADR.test(file)) {
      for (const target of linkTargets(file, text)) {
        depend(file, target);
      }
    }
    if (file.endsWith(".md")) {
      continue;
    }
    for (const line of text.split("\n")) {
      const path = (MARKER.exec(line)?.[2] ?? "").replace(/[.,;:)]+$/, "");
      if (PLAN.test(path) || ADR.test(path)) {
        depend(path, file);
      }
    }
  }
  return dependencies;
}

/** The repository paths a document's prose links to. */
function linkTargets(file: string, text: string): string[] {
  const targets: string[] = [];
  for (const { text: prose } of proseLines(text)) {
    for (const [, raw = ""] of prose.matchAll(LINK)) {
      const [pathPart] = raw.split("#", 1);
      const target =
        isExternal(raw) || !pathPart
          ? null
          : resolve(file, decodeURI(pathPart));
      if (target !== null) {
        targets.push(target);
      }
    }
  }
  return targets;
}

/**
 * Plans and ADRs whose `last-verified` date is older than the latest commit to
 * a file they link to, or to a file whose Docs/Plan/ADR marker points at them.
 * Without deps.commitDate nothing is stale.
 */
export async function staleDocuments(
  deps: HistoryDeps,
): Promise<StaleDocument[]> {
  const commitDate = deps.commitDate?.bind(deps);
  if (!commitDate) {
    return [];
  }
  const stale: StaleDocument[] = [];
  for (const [document, paths] of dependenciesOf(deps)) {
    const verified = frontmatter(document, deps.read(document) ?? "")?.keys.get(
      "last-verified",
    )?.value;
    if (!verified || !DATE.test(verified)) {
      continue;
    }
    let newest: { path: string; date: string } | null = null;
    for (const path of [...paths].sort()) {
      const date = await commitDate(path);
      if (date && (newest === null || date > newest.date)) {
        newest = { path, date };
      }
    }
    if (newest && newest.date > verified) {
      stale.push({ document, verified, ...newest });
    }
  }
  return stale.sort((a, b) => a.document.localeCompare(b.document));
}
