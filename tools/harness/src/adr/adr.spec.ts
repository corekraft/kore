import { describe, expect, it } from "vitest";
import { run } from "../cli/index.js";
import { ANCHOR, INDEX, NEW, PLAN, adrFile, fixture } from "./adr-support.js";

describe("harness adr new", () => {
  it("writes flat frontmatter with the injected clock's date and the body skeleton", async () => {
    const f = fixture();
    await run(NEW, f.deps);
    const text = f.fs.files.get(
      "docs/decisions/0004-harness-tools-are-great.md",
    );
    expect(text?.split("\n").slice(0, 7)).toEqual([
      "---",
      "status: proposed",
      "summary: Tools are great.",
      "date: 2026-11-11",
      "last-verified: 2026-11-11",
      "---",
      "",
    ]);
    expect(text).toContain("# ADR 0004: Harness tools Are Great!");
    for (const h of ["## Context", "## Decision", "## Consequences"]) {
      expect(text).toContain(h);
    }
  });

  it("numbers from the highest existing ADR, past gaps", async () => {
    const f = fixture();
    await run([...NEW, "--json"], f.deps);
    expect(JSON.parse(f.out())).toMatchObject({ number: "0004" });
  });

  it("skips a parallel ADR already on disk", async () => {
    const f = fixture({
      "docs/decisions/0004-parallel.md": adrFile("0004", "parallel"),
    });
    await run([...NEW, "--json"], f.deps);
    expect(JSON.parse(f.out())).toMatchObject({ number: "0005" });
    expect(f.fs.files.has("docs/decisions/0004-parallel.md")).toBe(true);
  });

  it("numbers the first ADR 0001 in an empty decisions directory", async () => {
    const f = fixture();
    f.fs.files.delete("docs/decisions/0001-first.md");
    f.fs.files.delete("docs/decisions/0003-third.md");
    await run([...NEW, "--json"], f.deps);
    expect(JSON.parse(f.out())).toMatchObject({ number: "0001" });
  });

  it("inserts the index line after the last decision entry, keeping numeric order", async () => {
    const f = fixture();
    await run(NEW, f.deps);
    const lines = f.fs.files.get("docs/index.md")?.split("\n") ?? [];
    const at = lines.findIndex((l) => l.includes("0004-"));
    expect(lines[at - 1]).toContain("0003-third.md");
    expect(lines[at]).toBe(
      "- [`docs/decisions/0004-harness-tools-are-great.md`](decisions/0004-harness-tools-are-great.md) — Tools are great.",
    );
  });

  it("inserts before a later-numbered entry", async () => {
    const f = fixture();
    f.fs.files.set(
      "docs/index.md",
      INDEX.replace(
        "- [`docs/decisions/0003-third.md`](decisions/0003-third.md) — third.",
        "- [`docs/decisions/0009-ninth.md`](decisions/0009-ninth.md) — ninth.",
      ),
    );
    f.fs.files.delete("docs/decisions/0003-third.md");
    f.fs.files.set("docs/decisions/0002-second.md", adrFile("0002", "second"));
    await run(["adr", "new", ...NEW.slice(2)], f.deps);
    const lines = f.fs.files.get("docs/index.md")?.split("\n") ?? [];
    const at = lines.findIndex((l) => l.includes("0003-harness"));
    expect(lines[at - 1]).toContain("0001-first.md");
    expect(lines[at + 1]).toContain("0009-ninth.md");
  });
});

describe("harness adr new output", () => {
  it("reports every file and line written, as JSON", async () => {
    const f = fixture();
    await run([...NEW, "--json"], f.deps);
    const report = JSON.parse(f.out()) as {
      dryRun: boolean;
      files: { path: string; lines: { number: number; text: string }[] }[];
    };
    expect(report.dryRun).toBe(false);
    expect(report.files.map((x) => x.path)).toEqual([
      "docs/decisions/0004-harness-tools-are-great.md",
      "docs/index.md",
    ]);
    const adr = f.fs.files.get(report.files[0]?.path ?? "")?.split("\n") ?? [];
    expect(report.files[0]?.lines.map((l) => l.text)).toEqual(adr.slice(0, -1));
    const index = report.files[1]?.lines ?? [];
    expect(index).toHaveLength(1);
    expect(
      f.fs.files.get("docs/index.md")?.split("\n")[(index[0]?.number ?? 0) - 1],
    ).toBe(index[0]?.text);
  });

  it("dry-run reports the same files and lines as a real run and writes nothing", async () => {
    const real = fixture();
    await run([...NEW, "--json"], real.deps);
    const dry = fixture();
    expect(await run([...NEW, "--dry-run", "--json"], dry.deps)).toBe(0);
    const a = JSON.parse(real.out()) as { dryRun: boolean; files: unknown };
    const b = JSON.parse(dry.out()) as { dryRun: boolean; files: unknown };
    expect(b.dryRun).toBe(true);
    expect(b.files).toEqual(a.files);
    expect(dry.fs.writes).toEqual([]);
  });
});

describe("harness adr new validation", () => {
  it("rejects a status outside proposed, accepted, superseded and writes nothing", async () => {
    const f = fixture();
    const argv = NEW.map((a) => (a === "proposed" ? "draft" : a));
    expect(await run(argv, f.deps)).toBe(1);
    expect(f.err()).toContain("draft");
    expect(f.err()).toContain("proposed, accepted");
    expect(f.fs.writes).toEqual([]);
  });

  it("rejects superseded and points to the supersede command", async () => {
    const f = fixture();
    const argv = NEW.map((a) => (a === "proposed" ? "superseded" : a));
    expect(await run(argv, f.deps)).toBe(1);
    expect(f.err()).toContain("harness adr supersede");
    expect(f.err()).toContain("proposed or accepted");
    expect(f.fs.writes).toEqual([]);
  });

  it("always writes Source and writes Refines only when given", async () => {
    const plain = fixture();
    await run(NEW, plain.deps);
    const a = plain.fs.files.get(
      "docs/decisions/0004-harness-tools-are-great.md",
    );
    expect(a).toContain(`Source: [\`${PLAN}\` § Step 1]`);
    expect(a).not.toContain("Refines:");

    const refined = fixture();
    await run([...NEW, "--refines", "ADR 0001"], refined.deps);
    const b = refined.fs.files.get(
      "docs/decisions/0004-harness-tools-are-great.md",
    );
    expect(b).toContain("Refines: ADR 0001");
  });

  it.each([
    ["title", "--title"],
    ["summary", "--summary"],
    ["status", "--status"],
    ["source", "--source"],
  ])("requires --%s and names the fix", async (name, flag) => {
    const f = fixture();
    const at = NEW.indexOf(flag);
    const argv = [...NEW.slice(0, at), ...NEW.slice(at + 2)];
    expect(await run(argv, f.deps)).toBe(1);
    expect(f.err()).toContain(`--${name}`);
    expect(f.fs.writes).toEqual([]);
  });

  it("rejects a multi-line or YAML-special summary", async () => {
    for (const summary of ["a\nb", "- list", "[x]"]) {
      const f = fixture();
      const argv = NEW.map((a) => (a === "Tools are great." ? summary : a));
      expect(await run(argv, f.deps)).toBe(1);
      expect(f.err()).toContain("--summary");
      expect(f.fs.writes).toEqual([]);
    }
  });
});

describe("harness adr new source, root and date", () => {
  it("rejects a missing plan file, naming it, and writes nothing", async () => {
    const f = fixture();
    const argv = NEW.map((a) =>
      a.includes("#") ? "infra/plans/nope.md#x" : a,
    );
    expect(await run(argv, f.deps)).toBe(1);
    expect(f.err()).toContain("infra/plans/nope.md");
    expect(f.fs.writes).toEqual([]);
  });

  it("rejects an unknown anchor, suggesting a real one", async () => {
    const f = fixture();
    const argv = NEW.map((a) => (a.includes("#") ? `${PLAN}#step-9` : a));
    expect(await run(argv, f.deps)).toBe(1);
    expect(f.err()).toContain("#step-9");
    expect(f.err()).toContain(`#${ANCHOR}`);
    expect(f.fs.writes).toEqual([]);
  });

  it("labels the link with the heading's step, as ADR 0001 does", async () => {
    const f = fixture();
    await run(NEW, f.deps);
    expect(
      f.fs.files.get("docs/decisions/0004-harness-tools-are-great.md"),
    ).toContain(`§ Step 1](../../${PLAN}#${ANCHOR})`);
  });

  it("fails with a named error when no repository root is found", async () => {
    const f = fixture();
    const deps = {
      ...f.deps,
      root: () => Promise.reject(new Error("Cannot find the repo root: x")),
    };
    expect(await run([...NEW, "--json"], deps)).toBe(1);
    expect(JSON.parse(f.err())).toEqual({
      error: expect.stringContaining("repo root") as string,
    });
    expect(f.fs.writes).toEqual([]);
  });

  it("stamps the local date from the clock, not the UTC date", async () => {
    const zone = process.env["TZ"];
    process.env["TZ"] = "Pacific/Auckland";
    try {
      const f = fixture();
      const deps = {
        ...f.deps,
        clock: { now: () => new Date("2026-11-11T20:00:00Z") },
      };
      await run(NEW, deps);
      expect(
        f.fs.files.get("docs/decisions/0004-harness-tools-are-great.md"),
      ).toContain("date: 2026-11-12\n");
    } finally {
      if (zone === undefined) {
        delete process.env["TZ"];
      } else {
        process.env["TZ"] = zone;
      }
    }
  });
});

describe("harness adr new edge cases", () => {
  it("rejects a title with no letters or digits", async () => {
    const f = fixture();
    const argv = NEW.map((a) => (a === "Harness tools Are Great!" ? "!!!" : a));
    expect(await run(argv, f.deps)).toBe(1);
    expect(f.err()).toContain("--title");
  });

  it("reports a missing index heading and writes nothing", async () => {
    const f = fixture();
    f.fs.files.set("docs/index.md", "# Index\n");
    expect(await run(NEW, f.deps)).toBe(1);
    expect(f.err()).toContain("## Decisions");
    expect(f.fs.writes).toEqual([]);
  });

  it("appends to an empty Decisions section", async () => {
    const f = fixture();
    f.fs.files.delete("docs/decisions/0001-first.md");
    f.fs.files.delete("docs/decisions/0003-third.md");
    f.fs.files.set(
      "docs/index.md",
      "# Index\n\n## Decisions\n\nIntro.\n\n## Other\n",
    );
    await run(NEW, f.deps);
    const lines = f.fs.files.get("docs/index.md")?.split("\n") ?? [];
    expect(lines.indexOf("Intro.")).toBeLessThan(
      lines.findIndex((l) => l.includes("0001-harness")),
    );
    expect(lines.findIndex((l) => l.includes("0001-harness"))).toBeLessThan(
      lines.indexOf("## Other"),
    );
  });

  it("reports a missing index file and writes nothing", async () => {
    const f = fixture();
    f.fs.files.delete("docs/index.md");
    expect(await run(NEW, f.deps)).toBe(1);
    expect(f.err()).toContain("docs/index.md");
    expect(f.fs.writes).toEqual([]);
  });

  it("prints a human summary without --json and a JSON error with it", async () => {
    const f = fixture();
    await run(NEW, f.deps);
    expect(f.out()).toContain("docs/decisions/0004-harness-tools-are-great.md");
    const g = fixture();
    await run(
      [...NEW.map((a) => (a === "proposed" ? "x" : a)), "--json"],
      g.deps,
    );
    expect(g.err()).toContain('{"error"');
  });

  it("source without an anchor links the path alone", async () => {
    const f = fixture();
    const argv = NEW.map((a) => (a.includes("#") ? PLAN : a));
    await run(argv, f.deps);
    expect(
      f.fs.files.get("docs/decisions/0004-harness-tools-are-great.md"),
    ).toContain(`Source: [\`${PLAN}\`](../../${PLAN})`);
  });
});

describe("harness flag parsing", () => {
  it("accepts --flag=value", async () => {
    const f = fixture();
    const eq = [
      "adr",
      "new",
      "--title=Equals Form",
      "--summary=s.",
      "--status=accepted",
      `--source=${PLAN}#${ANCHOR}`,
    ];
    expect(await run(eq, f.deps)).toBe(0);
    expect(f.fs.files.has("docs/decisions/0004-equals-form.md")).toBe(true);
  });

  it("rejects a valued flag with no value", async () => {
    const f = fixture();
    expect(await run(["adr", "new", "--title"], f.deps)).toBe(2);
    expect(f.err()).toContain("--title");
  });

  it("rejects a switch given a value and an unexpected positional", async () => {
    const f = fixture();
    expect(await run([...NEW, "--dry-run=yes"], f.deps)).toBe(2);
    expect(await run([...NEW, "stray"], f.deps)).toBe(2);
  });
});
