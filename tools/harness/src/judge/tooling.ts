import { isDeepStrictEqual } from "node:util";
import type { ChangedFile, TrailLine } from "./diff.js";

/** Developer tooling: what builds, tests, guards and ships the code, never what a user or cluster runs. ADR 0099. */
const TOOLING_PATH =
  /^(tools\/harness\/|\.claude\/|skills\/|tools\/kore\/(tests\/|\.husky\/|scripts\/|[^/]+\.config\.[^/]+$)|tools\/kore\/integration-setup\.ts$|\.github\/workflows\/(check|nightly|integration)\.yml$|\.mise\.toml$)/;

/** Test support kept inside `tools/kore/src`, recognised by name; a production file with such a name slips past and the judge reads the diff. */
const TEST_SUPPORT =
  /^tools\/kore\/src\/(testing\/|.*(\.fixtures\.ts|-fixtures\.ts|-support\.ts)$)/;

/** A list of unconverted sources, which every conversion edits (ADR 0098 and plan 14). */
const UNCONVERTED = /(^|\/)unconverted\.txt$/;
export const MANIFEST = "tools/kore/package.json";
const GITIGNORE = ".gitignore";
const TEST_RESULTS_IGNORE = "test-results/";
const LOCKFILE = "tools/kore/package-lock.json";
const ROOT_TOOLING_SECTION = /^ {6}"devDependencies"\s*:/;
const ROOT_KEY = /^ {6}"[^"]+"\s*:/;
const PACKAGE_ENTRY = /^ {4}"(node_modules\/[^"]*|)"\s*:\s*\{/;
/** A key at top or entry depth that is not a package entry, or a package entry hand-indented to another depth. */
const STRAY_KEY = /^( {2}"[^"]*"| {4}"[^"]*"|\s*"node_modules\/[^"]*")\s*:/;
const ENTRY_CLOSE = /^ {4}\}/;
const DEV_ONLY = /^\s*"dev"\s*:\s*true\b/;

/** The manifest without its tooling sections, or undefined when the text is not a JSON object. */
function withoutToolingSections(
  text: string,
): Record<string, unknown> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  const rest: Record<string, unknown> = { ...parsed };
  delete rest["scripts"];
  delete rest["devDependencies"];
  return rest;
}

/**
 * Only scripts or devDependencies change: the whole manifest at the merge base and at the head, compared
 * without those two sections, is equal. The hunk is not read, since its context can hide the section header.
 * Without both sides, or with no hunks, the change is product.
 */
function manifestIsTooling(file: ChangedFile): boolean {
  const { before, after } = file.sides ?? {};
  if (file.trail.length === 0 || before === undefined || after === undefined) {
    return false;
  }
  const rest = withoutToolingSections(before);
  return (
    rest !== undefined && isDeepStrictEqual(rest, withoutToolingSections(after))
  );
}

/** The `.gitignore` change is tooling only when its one changed line adds the test-results ignore. */
function gitignoreIsTooling(trail: readonly TrailLine[]): boolean {
  const changed = trail.filter((line) => line.kind !== "context");
  return (
    changed.length === 1 &&
    changed[0]?.kind === "added" &&
    changed[0].text === TEST_RESULTS_IGNORE
  );
}

/** What is known of the lockfile entry the walk is inside. */
class Entry {
  private name: string | undefined;
  private headerChanged = false;
  private dev = false;
  private touched = false;
  private rootSection: boolean | undefined;

  reset(): void {
    this.name = undefined;
    this.headerChanged = false;
    this.dev = false;
    this.touched = false;
    this.rootSection = undefined;
  }

  /** Whether the entry the walk leaves is safe: untouched, dev only, or a root devDependencies change. */
  settled(): boolean {
    return this.name === undefined || !this.touched || this.dev;
  }

  open(line: TrailLine, name: string): void {
    this.reset();
    this.name = name;
    this.headerChanged = line.kind !== "context";
    this.touched = this.headerChanged;
  }

  /** Takes one line of the entry; false when a changed line cannot be shown to be tooling. */
  take({ kind, text }: TrailLine): boolean {
    if (this.name === "") {
      return this.takeRoot(kind, text);
    }
    if (DEV_ONLY.test(text) && (kind === "context" || this.headerChanged)) {
      this.dev = true;
    }
    if (kind !== "context") {
      if (this.name === undefined) {
        return false;
      }
      this.touched = true;
    }
    return true;
  }

  private takeRoot(kind: TrailLine["kind"], text: string): boolean {
    if (ROOT_KEY.test(text)) {
      this.rootSection = ROOT_TOOLING_SECTION.test(text);
    }
    return kind === "context" || this.rootSection === true;
  }
}

/** Every package entry the diff touches is dev only, and the root entry changes only in devDependencies. */
function lockfileIsTooling(trail: readonly TrailLine[]): boolean {
  if (trail.length === 0) {
    return false;
  }
  const entry = new Entry();
  for (const line of trail) {
    const header = PACKAGE_ENTRY.exec(line.text)?.[1];
    const stray = header === undefined && STRAY_KEY.test(line.text);
    if ((line.start || header !== undefined || stray) && !entry.settled()) {
      return false;
    }
    if (line.start) {
      entry.reset();
    }
    if (header !== undefined) {
      entry.open(line, header);
    } else if (stray) {
      if (line.kind !== "context") {
        return false;
      }
      entry.reset();
    } else if (!entry.take(line)) {
      return false;
    } else if (ENTRY_CLOSE.test(line.text)) {
      if (!entry.settled()) {
        return false;
      }
      entry.reset();
    }
  }
  return entry.settled();
}

const pathIsTooling = (path: string) =>
  TOOLING_PATH.test(path) || TEST_SUPPORT.test(path) || UNCONVERTED.test(path);

/** Whether a changed file is developer tooling rather than product behaviour; anything unclear is product, and a rename counts only when both paths are tooling. */
export function isTooling(file: ChangedFile): boolean {
  if (file.path !== file.previousPath) {
    return pathIsTooling(file.path) && pathIsTooling(file.previousPath);
  }
  if (file.path === MANIFEST) {
    return manifestIsTooling(file);
  }
  if (file.path === GITIGNORE) {
    return gitignoreIsTooling(file.trail);
  }
  if (file.path === LOCKFILE) {
    return lockfileIsTooling(file.trail);
  }
  return pathIsTooling(file.path);
}
