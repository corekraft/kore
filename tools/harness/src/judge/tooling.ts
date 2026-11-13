import type { ChangedFile, TrailLine } from "./diff.js";

/** Developer tooling: what builds, tests, guards and ships the code, never what a user or cluster runs. ADR 0099. */
const TOOLING_PATH =
  /^(tools\/harness\/|\.claude\/|skills\/|tools\/kore\/(tests\/|\.husky\/|scripts\/|[^/]+\.config\.[^/]+$)|\.github\/workflows\/(check|nightly)\.yml$)/;

/** Test support kept inside `tools/kore/src`, recognised by name; a production file with such a name slips past and the judge reads the diff. */
const TEST_SUPPORT =
  /^tools\/kore\/src\/(testing\/|.*(\.fixtures\.ts|-fixtures\.ts|-support\.ts)$)/;

const MANIFEST = "tools/kore/package.json";
const LOCKFILE = "tools/kore/package-lock.json";
const TOOLING_SECTION = /^ {2}"(scripts|devDependencies)"\s*:/;
const TOP_KEY = /^ {2}"[^"]+"\s*:/;
const ROOT_TOOLING_SECTION = /^ {6}"devDependencies"\s*:/;
const ROOT_KEY = /^ {6}"[^"]+"\s*:/;
const PACKAGE_ENTRY = /^ {4}"(node_modules\/[^"]*|)"\s*:\s*\{/;
/** A key at top or entry depth that is not a package entry, or a package entry hand-indented to another depth. */
const STRAY_KEY = /^( {2}"[^"]*"| {4}"[^"]*"|\s*"node_modules\/[^"]*")\s*:/;
const ENTRY_CLOSE = /^ {4}\}/;
const DEV_ONLY = /^\s*"dev"\s*:\s*true\b/;

/** Only scripts or devDependencies change. State resets at each hunk, so a change counts only under a header in view. */
function manifestIsTooling(trail: readonly TrailLine[]): boolean {
  if (trail.length === 0) {
    return false;
  }
  let tooling = false;
  for (const { kind, text, start } of trail) {
    if (start) {
      tooling = false;
    }
    if (TOP_KEY.test(text)) {
      tooling = TOOLING_SECTION.test(text);
    }
    if (kind !== "context" && !tooling) {
      return false;
    }
  }
  return true;
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
  TOOLING_PATH.test(path) || TEST_SUPPORT.test(path);

/** Whether a changed file is developer tooling rather than product behaviour; anything unclear is product, and a rename counts only when both paths are tooling. */
export function isTooling(file: ChangedFile): boolean {
  if (file.path !== file.previousPath) {
    return pathIsTooling(file.path) && pathIsTooling(file.previousPath);
  }
  if (file.path === MANIFEST) {
    return manifestIsTooling(file.trail);
  }
  if (file.path === LOCKFILE) {
    return lockfileIsTooling(file.trail);
  }
  return pathIsTooling(file.path);
}
