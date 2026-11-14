import { beforeEach, describe, expect, it, vi } from "vitest";
import { localDate } from "../runtime/index.js";
import { Adrs, AdrError, type NewAdr } from "./adr.js";
import {
  ANCHOR,
  INDEX,
  PLAN,
  PLAN_TEXT,
  ROOT,
  adrFile,
  fakeClock,
  fakeFileSystem,
} from "./adr-support.js";

vi.mock("../runtime/index.js", () => ({ localDate: vi.fn() }));

const NOW = new Date(2026, 10, 11, 23, 59, 59);
const DATE = "2026-11-11";
const PATH = "docs/decisions/0004-harness-tools-are-great.md";
const THIRD =
  "- [`docs/decisions/0003-third.md`](decisions/0003-third.md) — third.";
/** The index line the decision adds, for the number it is given. */
const entryFor = (n: string) =>
  `- [\`docs/decisions/${n}-harness-tools-are-great.md\`](decisions/${n}-harness-tools-are-great.md) — Tools are great.`;
const ENTRY = entryFor("0004");
const REPOSITORY = {
  "docs/index.md": INDEX,
  "docs/decisions/0001-first.md": adrFile("0001", "first"),
  "docs/decisions/0003-third.md": adrFile("0003", "third"),
  [PLAN]: PLAN_TEXT,
};
const NEW_ADR: NewAdr = {
  title: "Harness tools Are Great!",
  summary: "Tools are great.",
  status: "proposed",
  source: `${PLAN}#${ANCHOR}`,
};

/** The file the decision writes, with its optional Refines paragraph. */
const adrBody = (refines: string[] = []) =>
  [
    "---",
    "status: proposed",
    "summary: Tools are great.",
    `date: ${DATE}`,
    `last-verified: ${DATE}`,
    "---",
    "",
    "# ADR 0004: Harness tools Are Great!",
    "",
    `Source: [\`${PLAN}\` § Step 1](../../${PLAN}#${ANCHOR})`,
    ...refines,
    "",
    "## Context",
    "",
    "## Decision",
    "",
    "## Consequences",
    "",
  ].join("\n");

const numbered = (texts: string[]) =>
  texts.map((text, i) => ({ number: i + 1, text }));

function adrs(files: Record<string, string> = REPOSITORY) {
  const fs = fakeFileSystem(files);
  const clock = fakeClock(NOW);
  return { fs, clock, adrs: new Adrs(fs, clock, ROOT) };
}

beforeEach(() => {
  vi.mocked(localDate).mockReturnValue(DATE);
});

describe("Adrs.create writes", () => {
  it("writes the ADR file and its index line, and reports the lines it wrote", async () => {
    const { fs, adrs: decisions } = adrs();
    const report = await decisions.create(NEW_ADR, false);
    expect(fs.writeFile.mock.calls).toEqual([
      [`${ROOT}/${PATH}`, adrBody()],
      [`${ROOT}/docs/index.md`, INDEX.replace(THIRD, `${THIRD}\n${ENTRY}`)],
    ]);
    expect(report).toEqual({
      dryRun: false,
      number: "0004",
      files: [
        { path: PATH, lines: numbered(adrBody().split("\n").slice(0, -1)) },
        { path: "docs/index.md", lines: [{ number: 11, text: ENTRY }] },
      ],
    });
  });

  it("stamps the date that localDate gives the injected clock's instant", async () => {
    const { adrs: decisions } = adrs();
    await decisions.create(NEW_ADR, false);
    expect(localDate).toHaveBeenCalledWith(NOW);
  });

  it("writes nothing on a dry run, and reports what a real run would write", async () => {
    const real = adrs();
    const dry = adrs();
    const realReport = await real.adrs.create(NEW_ADR, false);
    const dryReport = await dry.adrs.create(NEW_ADR, true);
    expect(dry.fs.writeFile).not.toHaveBeenCalled();
    expect(dryReport).toEqual({ ...realReport, dryRun: true });
  });

  it("writes a Refines paragraph after Source only when one is given", async () => {
    const { fs, adrs: decisions } = adrs();
    await decisions.create({ ...NEW_ADR, refines: "ADR 0001" }, false);
    expect(fs.writeFile.mock.calls[0]).toEqual([
      `${ROOT}/${PATH}`,
      adrBody(["", "Refines: ADR 0001"]),
    ]);
  });
});

describe("Adrs.create numbering", () => {
  it("numbers one past the highest ADR, past gaps and ignoring files that are not ADRs", async () => {
    const { fs, adrs: decisions } = adrs({
      ...REPOSITORY,
      "docs/decisions/README.md": "# Decisions\n",
    });
    expect((await decisions.create(NEW_ADR, true)).number).toBe("0004");
    expect(fs.readdir).toHaveBeenCalledWith(`${ROOT}/docs/decisions`);
  });

  it("numbers the first ADR 0001 when the decisions directory holds no ADR", async () => {
    const { adrs: decisions } = adrs({
      "docs/index.md": INDEX,
      [PLAN]: PLAN_TEXT,
    });
    const report = await decisions.create(NEW_ADR, true);
    expect(report.number).toBe("0001");
    expect(report.files[0]?.path).toBe(
      "docs/decisions/0001-harness-tools-are-great.md",
    );
  });
});

describe("Adrs.create index placement", () => {
  it("puts the entry before the first later-numbered entry", async () => {
    const NINTH =
      "- [`docs/decisions/0009-ninth.md`](decisions/0009-ninth.md) — ninth.";
    // Only 0001 exists, so the new ADR is 0002 and its entry precedes 0009.
    const { fs, adrs: decisions } = adrs({
      "docs/index.md": INDEX.replace(THIRD, NINTH),
      "docs/decisions/0001-first.md": adrFile("0001", "first"),
      [PLAN]: PLAN_TEXT,
    });
    await decisions.create(NEW_ADR, false);
    expect(fs.writeFile.mock.calls[1]).toEqual([
      `${ROOT}/docs/index.md`,
      INDEX.replace(THIRD, `${entryFor("0002")}\n${NINTH}`),
    ]);
  });

  it("appends to an empty Decisions section, before the next heading", async () => {
    const index = "# Index\n\n## Decisions\n\nIntro.\n\n## Other\n";
    const { fs, adrs: decisions } = adrs({
      "docs/index.md": index,
      [PLAN]: PLAN_TEXT,
    });
    const report = await decisions.create(NEW_ADR, false);
    expect(fs.writeFile.mock.calls[1]?.[1]).toBe(
      `# Index\n\n## Decisions\n\nIntro.\n${entryFor("0001")}\n\n## Other\n`,
    );
    expect(report.files[1]?.lines).toEqual([
      { number: 6, text: entryFor("0001") },
    ]);
  });
});

describe("Adrs.create refusals", () => {
  it.each([
    [
      "superseded",
      "--status superseded cannot be written by adr new, which has no superseded-by to record; create the ADR as proposed or accepted, then run `harness adr supersede`.",
    ],
    ["draft", '--status is "draft"; use one of proposed, accepted.'],
  ])("refuses status %s and writes nothing", async (status, message) => {
    const { fs, adrs: decisions } = adrs();
    await expect(
      decisions.create({ ...NEW_ADR, status }, false),
    ).rejects.toThrow(new AdrError(message));
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it.each(["a\nb", "- list", "[x]"])(
    "refuses the summary %j, which would break the frontmatter",
    async (summary) => {
      const { fs, adrs: decisions } = adrs();
      await expect(
        decisions.create({ ...NEW_ADR, summary }, false),
      ).rejects.toThrow(
        new AdrError(
          "--summary must be one plain line that does not start with [ { | > & * ! or -; reword it as a sentence.",
        ),
      );
      expect(fs.writeFile).not.toHaveBeenCalled();
    },
  );

  it("refuses a title with no letters or digits", async () => {
    const { adrs: decisions } = adrs();
    await expect(
      decisions.create({ ...NEW_ADR, title: "!!!" }, false),
    ).rejects.toThrow(
      new AdrError(
        "--title needs at least one letter or digit; give the decision a short name.",
      ),
    );
  });

  it("refuses a missing index file and writes nothing", async () => {
    const { fs, adrs: decisions } = adrs({ [PLAN]: PLAN_TEXT });
    await expect(decisions.create(NEW_ADR, false)).rejects.toThrow(
      new AdrError("docs/index.md is missing; restore it from git."),
    );
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it("refuses an index with no Decisions heading and writes nothing", async () => {
    const { fs, adrs: decisions } = adrs({
      "docs/index.md": "# Index\n",
      [PLAN]: PLAN_TEXT,
    });
    await expect(decisions.create(NEW_ADR, false)).rejects.toThrow(
      new AdrError(
        'docs/index.md has no "## Decisions" heading; add it above the ADR entries.',
      ),
    );
    expect(fs.writeFile).not.toHaveBeenCalled();
  });
});

describe("Adrs.create source link", () => {
  it("refuses a plan that does not exist, naming it", async () => {
    const { fs, adrs: decisions } = adrs();
    await expect(
      decisions.create({ ...NEW_ADR, source: "infra/plans/nope.md#x" }, false),
    ).rejects.toThrow(
      new AdrError(
        "--source infra/plans/nope.md does not exist; use a plan path from the repository root, e.g. infra/plans/<plan>.md#<heading-slug>.",
      ),
    );
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it("links the plan alone when the source has no anchor", async () => {
    const { fs, adrs: decisions } = adrs();
    await decisions.create({ ...NEW_ADR, source: PLAN }, false);
    expect(fs.writeFile.mock.calls[0]?.[1]).toContain(
      `Source: [\`${PLAN}\`](../../${PLAN})\n`,
    );
  });

  it("refuses an anchor that is no heading, listing the first five slugs", async () => {
    const { adrs: decisions } = adrs({
      ...REPOSITORY,
      [PLAN]:
        "# Plan\n\n## Step 1: ADR Tool\n\n## Step 2\n\n## Step 3\n\n## Step 4\n\n## Step 5\n",
    });
    await expect(
      decisions.create({ ...NEW_ADR, source: `${PLAN}#step-9` }, false),
    ).rejects.toThrow(
      new AdrError(
        `--source #step-9 is not a heading in ${PLAN}; use one of its heading slugs: #plan, #step-1-adr-tool, #step-2, #step-3, #step-4.`,
      ),
    );
  });

  it("ignores headings inside code fences when it looks for an anchor", async () => {
    const { adrs: decisions } = adrs({
      ...REPOSITORY,
      [PLAN]: "# Plan\n\n```\n## Hidden\n```\n\n## Real: x\n",
    });
    await expect(
      decisions.create({ ...NEW_ADR, source: `${PLAN}#hidden` }, false),
    ).rejects.toThrow(
      new AdrError(
        `--source #hidden is not a heading in ${PLAN}; use one of its heading slugs: #plan, #real-x.`,
      ),
    );
  });

  it("gives a repeated heading the -1 anchor and labels it by its text before the colon", async () => {
    const { fs, adrs: decisions } = adrs({
      ...REPOSITORY,
      [PLAN]: "# Plan\n\n## Step 1: First\n\n## Step 1: First\n",
    });
    await decisions.create(
      { ...NEW_ADR, source: `${PLAN}#step-1-first-1` },
      false,
    );
    expect(fs.writeFile.mock.calls[0]?.[1]).toContain(
      `Source: [\`${PLAN}\` § Step 1](../../${PLAN}#step-1-first-1)\n`,
    );
  });
});
