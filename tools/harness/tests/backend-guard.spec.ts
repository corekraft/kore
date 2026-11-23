import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Plan 16, Step 6: nothing outside terminal/ names a backend binary or reads its environment. A session runs through
// the Terminals port, and only its adapter knows the binary that backs it. Code that still names herdr is closed to
// the list below, each file with its reason: a reader of herdr-era ledger events or records, a retro recognizer of
// herdr transcript lines, or the guard that refuses raw input typed into a herdr pane (ADR 0123). Nothing else may.
const KEPT: Readonly<Record<string, string>> = {
  "ledger/schema.ts":
    "the ledger's source enumeration, which still accepts herdr events",
  "cli/ledger-help.ts":
    "the help text that lists the sources a ledger event may carry",
  "cli/ledger-command-support.ts":
    "a fixture of a herdr-era ledger event, read by the ledger list filter",
  "cli/flow-lines-finish.ts":
    "the herdr reading of finish and silent lines, read from herdr-era events",
  "cli/flow-lines-lead.ts":
    "the herdr reading of lead time, read from herdr-era events",
  "flow/ledger-source.ts": "reads which source a herdr-era event came from",
  "flow/source-figures.ts": "reads the herdr-era pane figures out of a ledger",
  "flow/main-session.ts":
    "reads the herdr-era main-session figures out of a ledger",
  "flow/writer-cost-support.ts":
    "a fixture of a herdr-era ledger event for the writer cost reader",
  "testing/flow-support.ts":
    "a fixture of herdr-era ledger events for the flow readers",
  "session/registry.ts":
    "reads the backend of a session record written before the flip",
  "hook/retro-main.ts":
    "the retro recognizer of herdr subcommands in transcripts",
  "hook/retro-bare.ts":
    "the retro recognizer of bare herdr sends in transcripts",
  "hook/retro-session.ts": "the retro tally of bare herdr sends per session",
  "hook/retro-scan-support.ts":
    "the retro tally of bare herdr sends, for its fixtures",
  "hook/retro-transcript.ts":
    "the retro recognizer of the herdr orchestrator tag in transcripts",
  "hook/guard-role-writes.ts":
    "the guard that refuses raw input typed into a herdr pane (ADR 0123)",
  "hook/guard-corpus-judgment.ts": "the guard corpus case for a raw herdr send",
};

const SOURCE = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const KORE_SOURCE = resolve(SOURCE, "../../kore/src");
const AGENTS_ROLE = resolve(SOURCE, "../../../infra/hosts/vps/roles/agents");

/** Every shipped .ts file under `dir`, excluding specs, as a path relative to `root`. */
function sources(dir: string, root: string = SOURCE): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sources(path, root);
    }
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".spec.ts")
      ? [relative(root, path)]
      : [];
  });
}

/** The code of a file's lines, with whole-line comments blanked: a comment may describe herdr, code may not call it. */
function codeLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => (/^\s*(\/\/|\/\*|\*)/.test(line) ? "" : line));
}

/** The code lines that name a backend binary, or read its environment, as `file:line`. */
function namingBackend(file: string, root: string = SOURCE): string[] {
  const text = readFileSync(join(root, file), "utf8");
  return codeLines(text).flatMap((line, index) =>
    /HERDR_/.test(line) ||
    /["'`]herdr["'`]/.test(line) ||
    /["'`]herdr (agent|pane|env|server)\b/.test(line)
      ? [`${file}:${index + 1}`]
      : [],
  );
}

/** Whether a file's code (not its comments) still mentions herdr at all, in any case. */
function mentionsHerdr(file: string): boolean {
  const text = readFileSync(join(SOURCE, file), "utf8");
  return codeLines(text).some((line) => /herdr/i.test(line));
}

describe("nothing outside terminal/ names a backend binary or reads its environment (plan 16, Step 6)", () => {
  it("names no backend in code outside terminal/, except the closed list of kept readers", () => {
    const offenders = sources(SOURCE)
      .filter((file) => !file.startsWith("terminal/") && !(file in KEPT))
      .flatMap((file) => namingBackend(file));

    expect(offenders).toEqual([]);
  });

  it("keeps the kept-reader list to files that still exist and still mention herdr, so it cannot rot", () => {
    const files = sources(SOURCE);
    const stale = Object.keys(KEPT).filter(
      (file) => !files.includes(file) || !mentionsHerdr(file),
    );

    expect(stale).toEqual([]);
  });
});

describe("the kore CLI names no backend binary either (plan 16, Step 6)", () => {
  it("names no backend in the code of tools/kore/src", () => {
    const offenders = sources(KORE_SOURCE, KORE_SOURCE).flatMap((file) =>
      namingBackend(file, KORE_SOURCE),
    );

    expect(offenders).toEqual([]);
  });
});

/** The tasks of an Ansible tasks file, each as the text of its `- name:` block, comment lines left out. */
function taskBlocks(text: string): string[] {
  return text
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n")
    .split(/^(?=- name:)/m)
    .filter((block) => block.startsWith("- name:"));
}

/** Whether a block names the herdr TUI binary: the word herdr, not herdr-core or the herdr-core release URL. */
function namesHerdrBinary(block: string): boolean {
  return /\bherdr\b(?!-core)/.test(
    block.replace(/releases\.herdr\.dev\/core/g, ""),
  );
}

describe("the agents role installs no herdr binary beside herdr-core (plan 16, Step 6)", () => {
  it("pins no herdr in the agent's global tools", () => {
    const defaults = readFileSync(
      join(AGENTS_ROLE, "defaults/main.yaml"),
      "utf8",
    );

    expect(defaults).not.toMatch(/^\s+herdr:/m);
  });

  it("names herdr in a task only to remove it", () => {
    const tasks = taskBlocks(
      readFileSync(join(AGENTS_ROLE, "tasks/main.yaml"), "utf8"),
    );
    const naming = tasks.filter(namesHerdrBinary);

    expect(naming.filter((block) => !/state: absent/.test(block))).toEqual([]);
    expect(naming).not.toEqual([]);
  });
});
