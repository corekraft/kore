import { describe, expect, it } from "vitest";
import { AdrError } from "./adr.js";
import { ROOT, adrFile, fakeFileSystem } from "./adr-support.js";
import { Supersession } from "./supersede.js";

const OLD = "docs/decisions/0001-first.md";
const NEW_PATH = "docs/decisions/0003-third.md";
const ACCEPTED = adrFile("0001", "first");
const SUPERSEDED = ACCEPTED.replace(
  "status: accepted",
  `status: superseded\nsuperseded-by: ${NEW_PATH}`,
);

const REPOSITORY = {
  [OLD]: ACCEPTED,
  [NEW_PATH]: adrFile("0003", "third"),
};

function supersession(files: Record<string, string> = REPOSITORY) {
  const fs = fakeFileSystem(files);
  return { fs, sup: new Supersession(fs, ROOT) };
}

describe("Supersession.supersede writes", () => {
  it("sets the old status and adds superseded-by with the replacement's path, changing no other line", async () => {
    const { fs, sup } = supersession();
    await sup.supersede("1", "3", false);
    expect(fs.writeFile.mock.calls).toEqual([[`${ROOT}/${OLD}`, SUPERSEDED]]);
  });

  it("reports exactly the two changed lines, with zero-padded numbers", async () => {
    const { sup } = supersession();
    expect(await sup.supersede("1", "3", false)).toEqual({
      dryRun: false,
      old: "0001",
      new: "0003",
      files: [
        {
          path: OLD,
          lines: [
            { number: 2, text: "status: superseded" },
            { number: 3, text: `superseded-by: ${NEW_PATH}` },
          ],
        },
      ],
    });
  });

  it("accepts the zero-padded form and reads the same file", async () => {
    const { fs, sup } = supersession();
    const report = await sup.supersede("0001", "0003", false);
    expect(report.old).toBe("0001");
    expect(fs.readFile).toHaveBeenCalledWith(`${ROOT}/${OLD}`);
  });

  it("dry-run reports the same lines and writes nothing", async () => {
    const real = supersession();
    const dry = supersession();
    const realReport = await real.sup.supersede("1", "3", false);
    const dryReport = await dry.sup.supersede("1", "3", true);
    expect(dry.fs.writeFile).not.toHaveBeenCalled();
    expect(dryReport).toEqual({ ...realReport, dryRun: true });
  });
});

describe("Supersession.supersede flag refusals", () => {
  it.each([
    [
      "first",
      "3",
      '--old must be an ADR number such as 12 or 0012; got "first".',
    ],
    [
      "1",
      "12345",
      '--new must be an ADR number such as 12 or 0012; got "12345".',
    ],
  ])(
    "refuses a non-number and writes nothing (%s, %s)",
    async (o, n, message) => {
      const { fs, sup } = supersession();
      await expect(sup.supersede(o, n, false)).rejects.toThrow(
        new AdrError(message),
      );
      expect(fs.writeFile).not.toHaveBeenCalled();
    },
  );

  it("refuses an ADR superseding itself", async () => {
    const { fs, sup } = supersession();
    await expect(sup.supersede("1", "1", false)).rejects.toThrow(
      new AdrError(
        "ADR 0001 cannot supersede itself; pass the replacing ADR's number as --new.",
      ),
    );
    expect(fs.writeFile).not.toHaveBeenCalled();
  });
});

describe("Supersession.supersede missing and chained ADRs", () => {
  it("refuses a missing old ADR, pointing at the decisions directory", async () => {
    const { sup } = supersession();
    await expect(sup.supersede("7", "3", false)).rejects.toThrow(
      new AdrError(
        "ADR 0007 does not exist; check the number against docs/decisions/.",
      ),
    );
  });

  it("refuses a missing replacement, saying to create it first", async () => {
    const { fs, sup } = supersession();
    await expect(sup.supersede("1", "9", false)).rejects.toThrow(
      new AdrError(
        "ADR 0009 does not exist; create it first with `harness adr new`.",
      ),
    );
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it("refuses an old ADR that is already superseded, naming its chain", async () => {
    const { fs, sup } = supersession({
      [OLD]: SUPERSEDED,
      [NEW_PATH]: adrFile("0003", "third"),
      "docs/decisions/0009-ninth.md": adrFile("0009", "ninth"),
    });
    await expect(sup.supersede("1", "9", false)).rejects.toThrow(
      new AdrError(
        `ADR 0001 is already superseded by ${NEW_PATH}; to replace that ADR instead, run \`harness adr supersede --old 0003 --new 0009\`.`,
      ),
    );
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it("refuses an already-superseded old ADR with no superseded-by line", async () => {
    const { sup } = supersession({
      [OLD]: ACCEPTED.replace("status: accepted", "status: superseded"),
      [NEW_PATH]: adrFile("0003", "third"),
    });
    await expect(sup.supersede("1", "3", false)).rejects.toThrow(
      new AdrError(
        "ADR 0001 is already superseded; fix its superseded-by line by hand.",
      ),
    );
  });
});

describe("Supersession.supersede frontmatter refusals", () => {
  it("refuses an accepted old ADR that already has superseded-by", async () => {
    const { sup } = supersession({
      [OLD]: ACCEPTED.replace(
        "status: accepted",
        `status: accepted\nsuperseded-by: ${NEW_PATH}`,
      ),
      [NEW_PATH]: adrFile("0003", "third"),
    });
    await expect(sup.supersede("1", "3", false)).rejects.toThrow(
      new AdrError(
        `${OLD} already has superseded-by although its status is accepted; fix the frontmatter by hand.`,
      ),
    );
  });

  it("refuses a replacement that is itself superseded", async () => {
    const { sup } = supersession({
      [OLD]: ACCEPTED,
      [NEW_PATH]: adrFile("0003", "third").replace(
        "status: accepted",
        "status: superseded",
      ),
    });
    await expect(sup.supersede("1", "3", false)).rejects.toThrow(
      new AdrError(
        "ADR 0003 is itself superseded; use the ADR that replaced it as --new.",
      ),
    );
  });

  it("refuses an old ADR without a frontmatter status", async () => {
    const { fs, sup } = supersession({
      [OLD]: "# ADR 0001: first\n",
      [NEW_PATH]: adrFile("0003", "third"),
    });
    await expect(sup.supersede("1", "3", false)).rejects.toThrow(
      new AdrError(
        `${OLD} has no frontmatter status; add a "status:" line before superseding it.`,
      ),
    );
    expect(fs.writeFile).not.toHaveBeenCalled();
  });
});

describe("Supersession.supersede duplicate numbers", () => {
  it.each([
    [
      "a number that matches two files",
      { "docs/decisions/0001-other.md": adrFile("0001", "other") },
      "ADR 0001 matches more than one file: docs/decisions/0001-first.md, docs/decisions/0001-other.md; renumber one so each ADR number is unique, then retry.",
    ],
    [
      "a replacement number that matches two files",
      { "docs/decisions/0003-other.md": adrFile("0003", "other") },
      "ADR 0003 matches more than one file: docs/decisions/0003-other.md, docs/decisions/0003-third.md; renumber one so each ADR number is unique, then retry.",
    ],
  ])("refuses %s, listing every match", async (_name, extra, message) => {
    const { fs, sup } = supersession({ ...REPOSITORY, ...extra });
    await expect(sup.supersede("1", "3", false)).rejects.toThrow(
      new AdrError(message),
    );
    expect(fs.writeFile).not.toHaveBeenCalled();
  });
});
