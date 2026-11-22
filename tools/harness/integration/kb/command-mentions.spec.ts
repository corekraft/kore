// Harness commands and flags a current document names, checked through the knowledge health check on a fake tree.
// Docs: infra/plans/17-harness-help-guide.md#step-1-help-guide

import { describe, expect, it } from "vitest";
import {
  check,
  cleanTree,
  planFrontmatter,
  adrFrontmatter,
} from "../../src/testing/index.js";

const GUIDE = "docs/guides/x.md";
const guide = (body: string) => cleanTree({ [GUIDE]: `# X\n\n${body}\n` });

describe("a harness command a current document names must exist", () => {
  it("a real command with its real flags is clean", () => {
    expect(
      check(guide("Run `harness pr open --title t --body-file b`.")),
    ).toEqual([]);
  });

  it("an unknown command is reported with its file, line, the reference and the nearest real command", () => {
    expect(check(guide("Run `harness pr opne --title t`."))).toEqual([
      {
        file: GUIDE,
        line: 3,
        message: "harness pr opne is not a harness command",
        fix: "use harness pr open, the nearest real command",
      },
    ]);
  });

  it("an unknown domain is reported as an unknown command", () => {
    expect(check(guide("Run `harness wat now`."))).toEqual([
      expect.objectContaining({
        file: GUIDE,
        line: 3,
        message: "harness wat now is not a harness command",
      }),
    ]);
  });

  it("an unknown flag is reported with the nearest flag the command declares", () => {
    expect(check(guide("Run `harness pr open --titel t`."))).toEqual([
      {
        file: GUIDE,
        line: 3,
        message: "harness pr open has no --titel flag",
        fix: "use --title, a flag it declares",
      },
    ]);
  });

  it("a placeholder and a prose mention are ignored", () => {
    expect(
      check(
        guide(
          "Run `harness <domain> <command>` and `harness pr <command> --title <t>`. The words harness pr opne in prose are not a command.",
        ),
      ),
    ).toEqual([]);
  });
});

describe("which documents the check reads", () => {
  it("a closed plan step is skipped and an open plan step is checked", () => {
    const plan = [
      planFrontmatter,
      "# Plan A",
      "",
      "## Steps",
      "",
      "### Step 1: Do It",
      "",
      "- [x] done",
      "Run `harness pr opne`.",
      "",
      "### Step 2: New",
      "",
      "- [ ] todo",
      "Run `harness pr opne`.",
      "",
    ].join("\n");
    expect(check(cleanTree({ "infra/plans/1-a.md": plan }))).toEqual([
      expect.objectContaining({
        file: "infra/plans/1-a.md",
        line: plan.split("\n").lastIndexOf("Run `harness pr opne`.") + 1,
        message: "harness pr opne is not a harness command",
      }),
    ]);
  });

  it("a superseded ADR is skipped and an accepted ADR is checked", () => {
    const body = "# ADR 0001\n\nRun `harness pr opne`.\n";
    const successor = "docs/decisions/0002-b.md";
    const index = `${cleanTree()["docs/index.md"]}- [\`${successor}\`](decisions/0002-b.md) — replaces A.\n`;
    const superseded = adrFrontmatter.replace(
      "status: accepted",
      `status: superseded\nsuperseded-by: ${successor}`,
    );
    expect(
      check(
        cleanTree({
          "docs/decisions/0001-a.md": `${superseded}${body}`,
          [successor]: `${adrFrontmatter}# ADR 0002: B\n`,
          "docs/index.md": index,
        }),
      ),
    ).toEqual([]);
    expect(
      check(
        cleanTree({ "docs/decisions/0001-a.md": `${adrFrontmatter}${body}` }),
      ),
    ).toEqual([
      expect.objectContaining({ file: "docs/decisions/0001-a.md", line: 9 }),
    ]);
  });

  it("a retro is history and is not checked", () => {
    expect(
      check(
        cleanTree({
          "docs/retros/2026-11-20-x.md": "Run `harness pr opne`.\n",
        }),
      ),
    ).toEqual([]);
  });
});

describe("a harness command a harness source file names in a string must exist", () => {
  const SOURCE = "tools/harness/src/kb/x.ts";

  it("a real command in a hint string is clean", () => {
    expect(
      check(
        cleanTree({
          [SOURCE]:
            'export const hint = "Run `harness pr open --title t`.";\n',
        }),
      ),
    ).toEqual([]);
  });

  it("an unknown command in an error text is reported with its file, line, the reference and the nearest real command", () => {
    expect(
      check(
        cleanTree({
          [SOURCE]:
            'export const a = 1;\nthrow new Error("Run `harness pr opne`.");\n',
        }),
      ),
    ).toEqual([
      {
        file: SOURCE,
        line: 2,
        message: "harness pr opne is not a harness command",
        fix: "use harness pr open, the nearest real command",
      },
    ]);
  });

  it("an unknown flag in an error text is reported with the nearest flag the command declares", () => {
    expect(
      check(
        cleanTree({
          [SOURCE]: 'throw new Error("Run `harness pr open --titel t`.");\n',
        }),
      ),
    ).toEqual([
      {
        file: SOURCE,
        line: 1,
        message: "harness pr open has no --titel flag",
        fix: "use --title, a flag it declares",
      },
    ]);
  });

  it("a command named in a comment, a spec file, or plain prose of a string is not checked", () => {
    expect(
      check(
        cleanTree({
          [SOURCE]:
            '// Run `harness pr opne`.\nthrow new Error("such as harness pr opne");\n',
          "tools/harness/src/kb/x.spec.ts":
            'const s = "Run `harness pr opne`.";\n',
        }),
      ),
    ).toEqual([]);
  });
});
