import { describe, expect, it } from "vitest";
import { run } from "../cli/index.js";
import { ANCHOR, NEW, PLAN, fixture } from "./adr-support.js";

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
