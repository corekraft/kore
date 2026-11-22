import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { domains } from "../../src/cli/index.js";
import { harnessMentions } from "../../src/help/index.js";

// The current documents: the skills, the agent definitions and the guides a person reads now. History
// (decisions, ideas, retros) and plans are left alone, as is the help the commands print themselves.
const ROOT = resolve(import.meta.dirname, "../../../..");
const DIRECTORIES = [
  "skills",
  ".claude/agents",
  "docs/guides",
  "docs/operations",
  "docs/agents",
];
const FILES = [
  "AGENTS.md",
  "README.md",
  "GLOSSARY.md",
  "docs/index.md",
  "docs/vision.md",
];

/** Agent definitions keep the flags they name until #1802 widens the guard: a writer or judge cannot read deeper help yet. */
const FLAGS_KEPT_UNTIL_1802 = ".claude/agents/";

function currentDocuments(): string[] {
  const inDirectories = DIRECTORIES.flatMap((dir) =>
    readdirSync(join(ROOT, dir), { recursive: true })
      .map(String)
      .filter((name) => name.endsWith(".md"))
      .map((name) => `${dir}/${name}`),
  );
  return [...inDirectories, ...FILES].sort();
}

const documents = currentDocuments();
const mentions = documents.flatMap((file) =>
  harnessMentions(readFileSync(join(ROOT, file), "utf8")).map((mention) => ({
    file,
    ...mention,
  })),
);

/** Why a mention names no command that exists, or undefined when it names one that does. */
function unknownReason(words: readonly string[]): string | undefined {
  const [domain, command] = words;
  if (domain === undefined) {
    return undefined;
  }
  if (!Object.hasOwn(domains, domain)) {
    return `no domain \`${domain}\``;
  }
  const commands = domains[domain] ?? {};
  if (command === undefined || Object.hasOwn(commands, command)) {
    return undefined;
  }
  return `no command \`${domain} ${command}\``;
}

describe("the current documents point at help instead of listing flags", () => {
  it("scans the real skills, agent definitions and guides, so the checks below are not vacuous", () => {
    expect(documents).toContain("skills/retro/SKILL.md");
    expect(documents).toContain(".claude/agents/writer.md");
    expect(documents).toContain("docs/guides/contributor.md");
    expect(mentions.length).toBeGreaterThan(50);
  });

  it("lists no flag of a harness command, outside the agent definitions that wait on #1802", () => {
    const listings = mentions
      .filter((m) => m.flags.length > 0)
      .filter((m) => !m.file.startsWith(FLAGS_KEPT_UNTIL_1802))
      .map(
        (m) =>
          `${m.file}:${m.line} lists --${m.flags.join(" --")} after harness ${m.words.join(" ")}`,
      );
    expect(listings).toEqual([]);
  });

  it("names only harness commands that exist", () => {
    const unknown = mentions
      .map((m) => {
        const reason = unknownReason(m.words);
        return reason === undefined
          ? undefined
          : `${m.file}:${m.line} names ${reason}`;
      })
      .filter((problem) => problem !== undefined);
    expect(unknown).toEqual([]);
  });
});
