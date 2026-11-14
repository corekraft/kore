import { describe, expect, it } from "vitest";
import { run } from "../cli/index.js";
import { INDEX, NEW, harness } from "../testing/index.js";

const PATH = "docs/ideas/0001-cache-the-probe-results.md";

describe("harness idea new", () => {
  it("allocates 0001, writes valid frontmatter, and lists it in the index", async () => {
    const h = harness();
    expect(await run([...NEW, "--json"], h.deps)).toBe(0);
    const text = h.get(PATH);
    expect(text).toContain("---\nsummary: Cache the probe results\n");
    expect(text).toContain("hypothesis: Caching probes cuts up time.\n");
    expect(text).toContain("expected-outcome: Up time drops by 20 percent.\n");
    expect(text).toContain(
      "measurement: Compare kore local up duration in the ledger.\n",
    );
    expect(text).toContain("safety-pattern: feature-flagged\n");
    expect(text).toContain("date: 2026-03-04\n");
    expect(text).toContain("# Idea 0001: Cache the probe results\n");
    expect(JSON.parse(h.out())).toMatchObject({
      created: true,
      number: "0001",
      path: PATH,
    });
    const index = h.get("docs/index.md") ?? "";
    expect(index).toContain(
      "- [`docs/ideas/0001-cache-the-probe-results.md`](ideas/0001-cache-the-probe-results.md) — Cache the probe results",
    );
    expect(index.indexOf("## Ideas")).toBeGreaterThan(
      index.indexOf("## Decisions"),
    );
    expect(index.indexOf("## Ideas")).toBeLessThan(
      index.indexOf("## Operations and Guides"),
    );
  });

  it("holds no workflow state: no status, approval, label, or assignee", async () => {
    const h = harness();
    await run(NEW, h.deps);
    expect(h.get(PATH)).not.toMatch(
      /^(status|approval|approved|label|labels|assignee|assignees|state):/m,
    );
  });

  it("takes the next number after the highest existing idea", async () => {
    const h = harness({
      "docs/index.md": INDEX,
      "docs/ideas/0007-old.md": "x",
      "docs/ideas/0003-older.md": "x",
    });
    await run([...NEW, "--slug", "fresh"], h.deps);
    expect(h.get("docs/ideas/0008-fresh.md")).toBeDefined();
  });

  it("records optional issue and parent links", async () => {
    const h = harness();
    await run([...NEW, "--issue", "185", "--parent", "0001"], h.deps);
    expect(h.get(PATH)).toContain("issue: 185\n");
    expect(h.get(PATH)).toContain("parent: 0001\n");
  });

  it("accepts --flag=value", async () => {
    const h = harness();
    const at = NEW.indexOf("--title");
    const argv = [...NEW];
    argv.splice(at, 2, `--title=${NEW[at + 1] ?? ""}`);
    expect(await run(argv, h.deps)).toBe(0);
    expect(h.get(PATH)).toBeDefined();
  });
});

describe("harness idea new numbering and idempotence", () => {
  it("rerunning with the same slug creates no duplicate file or index entry", async () => {
    const first = harness();
    await run([...NEW, "--slug", "probe"], first.deps);
    const again = harness(first.snapshot() as Record<string, string>);
    expect(await run([...NEW, "--slug", "probe", "--json"], again.deps)).toBe(
      0,
    );
    expect(JSON.parse(again.out())).toMatchObject({
      created: false,
      number: "0001",
    });
    expect(again.paths().filter((p) => p.startsWith("docs/ideas/"))).toEqual([
      "docs/ideas/0001-probe.md",
    ]);
    expect(again.get("docs/index.md")).toBe(first.get("docs/index.md"));
  });

  it("a rerun after a half-finished create adds the missing index entry", async () => {
    const h = harness();
    await run([...NEW, "--slug", "probe"], h.deps);
    h.set("docs/index.md", INDEX);
    await run([...NEW, "--slug", "probe"], h.deps);
    expect(h.get("docs/index.md")).toContain("0001-probe.md");
  });

  it("creates the file exclusively: a competing writer's file is never overwritten", async () => {
    const first = harness();
    await run([...NEW, "--slug", "probe"], first.deps);
    const competitor = first.get("docs/ideas/0001-probe.md") ?? "";
    const h = harness();
    h.fs.beforeCreate = (path) => {
      if (!h.fs.files.has(path)) {
        h.fs.files.set(path, `${competitor}`);
      }
    };
    expect(await run([...NEW, "--slug", "probe", "--json"], h.deps)).toBe(0);
    expect(JSON.parse(h.out())).toMatchObject({ created: false });
    expect(h.get("docs/ideas/0001-probe.md")).toBe(competitor);
  });
});

describe("harness idea new validation", () => {
  it.each([
    ["--title", "title"],
    ["--hypothesis", "hypothesis"],
    ["--expected-outcome", "expected-outcome"],
    ["--measurement", "measurement"],
    ["--safety-pattern", "safety-pattern"],
  ])("fails naming the missing %s and writes nothing", async (flag, name) => {
    const h = harness();
    const argv = [...NEW];
    argv.splice(argv.indexOf(flag), 2);
    expect(await run(argv, h.deps)).toBe(1);
    expect(h.err()).toContain(`--${name}`);
    expect(h.paths()).toEqual(["docs/index.md"]);
  });

  it("rejects an unknown safety pattern and lists the valid ones", async () => {
    const h = harness();
    const argv = [...NEW];
    argv[argv.indexOf("feature-flagged")] = "yolo";
    expect(await run(argv, h.deps)).toBe(1);
    expect(h.err()).toContain("no-behaviour-change");
    expect(h.err()).toContain("expand-contract");
  });

  it("rejects values that frontmatter cannot hold as a flat scalar", async () => {
    const h = harness();
    const argv = [...NEW];
    argv[argv.indexOf("Caching probes cuts up time.")] = "- starts like a list";
    expect(await run(argv, h.deps)).toBe(1);
    expect(h.err()).toContain("--hypothesis");
    expect(h.paths()).toEqual(["docs/index.md"]);
  });

  it("collapses multi-line values onto one line", async () => {
    const h = harness();
    const argv = [...NEW];
    argv[argv.indexOf("Caching probes cuts up time.")] = "Line one\nline two";
    await run(argv, h.deps);
    expect(h.get(PATH)).toContain("hypothesis: Line one line two\n");
  });

  it("reports a missing repository root as an actionable error", async () => {
    const h = harness();
    h.deps.root = () => Promise.reject(new Error("Cannot find the repo root."));
    expect(await run(NEW, h.deps)).toBe(1);
    expect(h.err()).toContain("Cannot find the repo root.");
  });

  it("reports a repository without a knowledge index", async () => {
    const h = harness({});
    h.set("infra/plans/x.md", "x");
    expect(await run(NEW, h.deps)).toBe(1);
    expect(h.err()).toContain("docs/index.md");
  });

  it("an invalid slug is rejected with the rule", async () => {
    const h = harness();
    expect(await run([...NEW, "--slug", "Bad Slug"], h.deps)).toBe(1);
    expect(h.err()).toContain("lowercase");
  });

  it("reports a flag that is missing its value", async () => {
    const h = harness();
    expect(await run(["idea", "new", "--title"], h.deps)).toBe(2);
    expect(h.err()).toContain('"--title" needs a value');
  });
});
