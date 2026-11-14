import { describe, expect, it } from "vitest";
import { run } from "../../src/cli/index.js";
import { adrFile, fixture } from "../../src/adr/adr-support.js";

const OLD = "docs/decisions/0001-first.md";
const NEW_PATH = "docs/decisions/0003-third.md";
const SUPERSEDE = ["adr", "supersede", "--old", "1", "--new", "3"];

describe("harness adr supersede", () => {
  it("sets the old ADR to superseded with the replacement's repository-root path", async () => {
    const f = fixture();
    expect(await run(SUPERSEDE, f.deps)).toBe(0);
    const lines = f.fs.files.get(OLD)?.split("\n") ?? [];
    expect(lines.slice(0, 4)).toEqual([
      "---",
      "status: superseded",
      `superseded-by: ${NEW_PATH}`,
      "summary: Existing.",
    ]);
  });

  it("changes no other line of the old ADR and leaves every other file alone", async () => {
    const f = fixture();
    const before = f.fs.files.get(OLD)?.split("\n") ?? [];
    await run(SUPERSEDE, f.deps);
    const after = f.fs.files.get(OLD)?.split("\n") ?? [];
    expect(after.filter((l) => !before.includes(l))).toEqual([
      "status: superseded",
      `superseded-by: ${NEW_PATH}`,
    ]);
    expect(after).toHaveLength(before.length + 1);
    expect(f.fs.writes).toEqual([OLD]);
  });

  it("reports exactly the changed lines as JSON", async () => {
    const f = fixture();
    await run([...SUPERSEDE, "--json"], f.deps);
    expect(JSON.parse(f.out())).toEqual({
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

  it("dry-run reports the same lines and writes nothing", async () => {
    const real = fixture();
    await run([...SUPERSEDE, "--json"], real.deps);
    const dry = fixture();
    await run([...SUPERSEDE, "--dry-run", "--json"], dry.deps);
    expect(JSON.parse(dry.out())).toEqual({
      ...JSON.parse(real.out()),
      dryRun: true,
    });
    expect(dry.fs.writes).toEqual([]);
  });

  it("accepts zero-padded numbers", async () => {
    const f = fixture();
    const argv = ["adr", "supersede", "--old", "0001", "--new", "0003"];
    expect(await run(argv, f.deps)).toBe(0);
  });

  it("prints a human summary without --json", async () => {
    const f = fixture();
    await run(SUPERSEDE, f.deps);
    expect(f.out()).toContain(OLD);
    expect(f.out()).toContain("superseded-by");
  });
});

describe("harness adr supersede refusals", () => {
  async function refuse(
    extra: Record<string, string>,
    argv: string[],
    message: string,
  ) {
    const f = fixture(extra);
    const before = new Map(f.fs.files);
    expect(await run(argv, f.deps)).toBe(1);
    expect(f.err()).toContain(message);
    expect(f.fs.files).toEqual(before);
    expect(f.fs.writes).toEqual([]);
  }

  it("refuses a missing replacement and names how to create it", async () => {
    await refuse(
      {},
      ["adr", "supersede", "--old", "1", "--new", "9"],
      "ADR 0009 does not exist; create it first with `harness adr new`",
    );
  });

  it("refuses a missing old ADR", async () => {
    await refuse(
      {},
      ["adr", "supersede", "--old", "7", "--new", "3"],
      "ADR 0007 does not exist",
    );
  });

  it("refuses an already-superseded old ADR", async () => {
    await refuse(
      {
        [OLD]: adrFile("0001", "first").replace(
          "status: accepted",
          "status: superseded\nsuperseded-by: docs/decisions/0003-third.md",
        ),
      },
      SUPERSEDE,
      "ADR 0001 is already superseded",
    );
  });

  it("refuses a superseded replacement", async () => {
    await refuse(
      {
        [NEW_PATH]: adrFile("0003", "third").replace(
          "status: accepted",
          "status: superseded",
        ),
      },
      SUPERSEDE,
      "ADR 0003 is itself superseded",
    );
  });

  it("refuses an ADR superseding itself", async () => {
    await refuse(
      {},
      ["adr", "supersede", "--old", "1", "--new", "1"],
      "cannot supersede itself",
    );
  });
});

describe("harness adr supersede flag and file refusals", () => {
  async function refuse(argv: string[], message: string, extra = {}) {
    const f = fixture(extra);
    expect(await run(argv, f.deps)).toBe(1);
    expect(f.err()).toContain(message);
    expect(f.fs.writes).toEqual([]);
  }

  it("refuses non-numeric and missing flags", async () => {
    await refuse(
      ["adr", "supersede", "--old", "first", "--new", "3"],
      "--old must be an ADR number",
    );
    await refuse(["adr", "supersede", "--old", "1"], "--new is required");
  });

  it("refuses an old ADR without frontmatter status", async () => {
    await refuse(SUPERSEDE, "has no frontmatter status", {
      [OLD]: "# ADR 0001: first\n",
    });
  });

  it("reports a JSON error with --json", async () => {
    const f = fixture();
    await run(
      ["adr", "supersede", "--old", "1", "--new", "9", "--json"],
      f.deps,
    );
    expect(JSON.parse(f.err())).toMatchObject({
      error: expect.stringContaining("0009"),
    });
  });
});

describe("harness adr supersede chains and duplicate numbers", () => {
  it("names the current superseded-by path and the command to chain from it", async () => {
    const f = fixture({
      [OLD]: adrFile("0001", "first").replace(
        "status: accepted",
        "status: superseded\nsuperseded-by: docs/decisions/0003-third.md",
      ),
      "docs/decisions/0009-ninth.md": adrFile("0009", "ninth"),
    });
    const argv = ["adr", "supersede", "--old", "1", "--new", "9"];
    expect(await run(argv, f.deps)).toBe(1);
    expect(f.err()).toContain(
      "already superseded by docs/decisions/0003-third.md; to replace that ADR instead, run `harness adr supersede --old 0003 --new 0009`",
    );
    expect(f.fs.writes).toEqual([]);
  });

  it("refuses a number shared by two files, listing both and saying to renumber", async () => {
    const f = fixture({
      "docs/decisions/0001-other.md": adrFile("0001", "other"),
    });
    expect(await run(SUPERSEDE, f.deps)).toBe(1);
    expect(f.err()).toContain("ADR 0001 matches more than one file");
    expect(f.err()).toContain("docs/decisions/0001-first.md");
    expect(f.err()).toContain("docs/decisions/0001-other.md");
    expect(f.err()).toContain("renumber one");
    expect(f.fs.writes).toEqual([]);
  });

  it("refuses a duplicated replacement number too", async () => {
    const f = fixture({
      "docs/decisions/0003-other.md": adrFile("0003", "other"),
    });
    expect(await run(SUPERSEDE, f.deps)).toBe(1);
    expect(f.err()).toContain("ADR 0003 matches more than one file");
    expect(f.fs.writes).toEqual([]);
  });
});
