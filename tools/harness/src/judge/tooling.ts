import type { ChangedFile } from "./diff.js";

/** Developer tooling: what builds, tests, guards and ships the code, never what a user or cluster runs. ADR 0099. */
const TOOLING_PATH =
  /^(tools\/harness\/|\.claude\/|skills\/|tools\/kore\/(tests\/|\.husky\/|scripts\/|[^/]+\.config\.[^/]+$)|\.github\/workflows\/(check|nightly)\.yml$)/;

/** Test support kept inside `tools/kore/src`, recognised by name; a production file with such a name slips past and the judge reads the diff. */
const TEST_SUPPORT =
  /^tools\/kore\/src\/(testing\/|.*(\.fixtures\.ts|-fixtures\.ts|-support\.ts)$)/;

const MANIFEST = "tools/kore/package.json";
const LOCKFILE = "tools/kore/package-lock.json";
const TOOLING_SECTION = /^ {2}"(scripts|devDependencies)"\s*:\s*\{/;
const ANY_SECTION = /^ {2}"[^"]+"\s*:/;
const PACKAGE_ENTRY = /^ {4}"(node_modules\/[^"]*|)"\s*:\s*\{/;
const DEV_ONLY = /^\s*"dev"\s*:\s*true\b/;

/** Only scripts or devDependencies change; a removal cannot be placed in a section, so it fails closed. */
function manifestIsTooling(file: ChangedFile): boolean {
  if (file.netRemoved > 0) {
    return false;
  }
  let tooling = false;
  for (const { added, text } of file.after) {
    if (ANY_SECTION.test(text)) {
      tooling = TOOLING_SECTION.test(text);
    } else if (added && !tooling) {
      return false;
    }
  }
  return true;
}

/** Every package entry the diff touches is dev only; a change outside any entry fails closed. */
function lockfileIsTooling(file: ChangedFile): boolean {
  if (file.netRemoved > 0) {
    return false;
  }
  let inEntry = false;
  let dev = false;
  let touched = false;
  const closes = () => !touched || dev;
  for (const { added, text } of file.after) {
    if (PACKAGE_ENTRY.test(text)) {
      if (!closes()) {
        return false;
      }
      inEntry = true;
      dev = false;
      touched = false;
    } else if (DEV_ONLY.test(text)) {
      dev = true;
    }
    if (added) {
      if (!inEntry) {
        return false;
      }
      touched = true;
    }
  }
  return closes();
}

/** Whether a changed file is developer tooling rather than product behaviour; anything unclear is product. */
export function isTooling(file: ChangedFile): boolean {
  if (file.path === MANIFEST) {
    return manifestIsTooling(file);
  }
  if (file.path === LOCKFILE) {
    return lockfileIsTooling(file);
  }
  return TOOLING_PATH.test(file.path) || TEST_SUPPORT.test(file.path);
}
