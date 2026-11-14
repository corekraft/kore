import { describe, expect, it } from "vitest";
import { run } from "../src/cli/index.js";
import { findings } from "../src/kb/index.js";
import {
  ADR_NEW as NEW,
  fixture,
  type MemoryFs,
} from "../src/testing/index.js";

async function kbFindings(fs: MemoryFs) {
  return findings({
    files: () => [...fs.files.keys()],
    read: (p) => fs.files.get(p) ?? null,
  });
}

describe("harness adr new against kb-check", () => {
  it("passes the frontmatter, link and index rules with no hand edits", async () => {
    const f = fixture();
    expect(await run(NEW, f.deps)).toBe(0);
    expect(await kbFindings(f.fs)).toEqual([]);
  });

  it("passes with a Refines line too", async () => {
    const f = fixture();
    expect(await run([...NEW, "--refines", "ADR 0001"], f.deps)).toBe(0);
    expect(await kbFindings(f.fs)).toEqual([]);
  });

  it("the check does notice a missing index entry (the fixture is not vacuous)", async () => {
    const f = fixture();
    await run(NEW, f.deps);
    f.fs.files.set(
      "docs/index.md",
      f.fs.files.get("docs/index.md")?.replace(/.*0004-.*\n/, "") ?? "",
    );
    expect(await kbFindings(f.fs)).not.toEqual([]);
  });
});

describe("harness adr supersede against kb-check", () => {
  it("leaves the superseded chain valid with no hand edits", async () => {
    const f = fixture();
    expect(await run(NEW, f.deps)).toBe(0);
    const argv = ["adr", "supersede", "--old", "3", "--new", "4"];
    expect(await run(argv, f.deps)).toBe(0);
    expect(await kbFindings(f.fs)).toEqual([]);
  });

  it("the check does notice a dangling superseded-by (the fixture is not vacuous)", async () => {
    const f = fixture();
    await run(["adr", "supersede", "--old", "1", "--new", "3"], f.deps);
    f.fs.files.delete("docs/decisions/0003-third.md");
    expect(await kbFindings(f.fs)).not.toEqual([]);
  });
});
