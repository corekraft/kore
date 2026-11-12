import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../cli/index.js";
import { nodeFileSystem } from "../runtime/index.js";
import { FakeRunner } from "../runtime/runner-support.js";
import { INDEX, NEW, harness, ideaText, seeded } from "./idea-support.js";

const FIELDS = {
  number: "0001",
  slug: "cache-the-probe-results",
  path: "docs/ideas/0001-cache-the-probe-results.md",
  title: "Cache the probe results",
  summary: "Cache the probe results",
  hypothesis: "Caching probes cuts up time.",
  expectedOutcome: "Up time drops by 20 percent.",
  measurement: "Compare kore local up duration in the ledger.",
  safetyPattern: "feature-flagged",
  date: "2026-03-04",
  issue: "185",
};

describe("harness idea show", () => {
  it.each([
    "1",
    "0001",
    "cache-the-probe-results",
    "0001-cache-the-probe-results",
  ])("--json prints the record's fields for --idea %s", async (ref) => {
    const fresh = harness(
      (await seeded()).snapshot() as Record<string, string>,
    );
    expect(
      await run(["idea", "show", "--idea", ref, "--json"], fresh.deps),
    ).toBe(0);
    expect(JSON.parse(fresh.out())).toEqual(FIELDS);
  });

  it("prints readable text without --json", async () => {
    const fresh = harness(
      (await seeded()).snapshot() as Record<string, string>,
    );
    await run(["idea", "show", "--idea", "1"], fresh.deps);
    expect(fresh.out()).toContain("Idea 0001: Cache the probe results");
    expect(fresh.out()).toContain("Hypothesis: Caching probes cuts up time.");
    expect(fresh.out()).toContain("Issue: 185");
    expect(fresh.out()).not.toMatch(/Status:/);
  });

  it("an unknown idea exits 1 with an actionable error", async () => {
    const h = harness();
    expect(await run(["idea", "show", "--idea", "9", "--json"], h.deps)).toBe(
      1,
    );
    const line = h.err().split("\n")[0] ?? "";
    expect(JSON.parse(line)).toEqual({
      error: expect.stringContaining("harness idea list") as unknown,
    });
    expect(h.out()).toBe("");
  });

  it("without --idea it fails and names the flag", async () => {
    const h = harness();
    expect(await run(["idea", "show"], h.deps)).toBe(1);
    expect(h.err()).toContain("--idea");
  });

  it("names a malformed record instead of printing it", async () => {
    const h = harness({
      "docs/index.md": INDEX,
      "docs/ideas/0001-bad.md": "no frontmatter\n",
    });
    expect(await run(["idea", "show", "--idea", "1"], h.deps)).toBe(1);
    expect(h.err()).toContain("docs/ideas/0001-bad.md");
    expect(h.err()).toContain("frontmatter");
  });

  it("reads one idea even when another record is malformed", async () => {
    const h = await seeded();
    h.set("docs/ideas/0002-bad.md", "no frontmatter\n");
    const fresh = harness(h.snapshot() as Record<string, string>);
    expect(await run(["idea", "show", "--idea", "1"], fresh.deps)).toBe(0);
    expect(fresh.out()).toContain("Idea 0001");
  });

  it("an idea with an outcome shows it; nothing else marks it closed", async () => {
    const h = harness({
      "docs/index.md": INDEX,
      "docs/ideas/0002-done.md": ideaText({ outcome: "refuted" }),
    });
    await run(["idea", "show", "--idea", "2", "--json"], h.deps);
    const record = JSON.parse(h.out()) as Record<string, unknown>;
    expect(record).toMatchObject({ outcome: "refuted", title: "Done" });
    expect(record).not.toHaveProperty("status");
  });
});

describe("harness idea list", () => {
  it("prints every idea in number order, as JSON on request", async () => {
    const more = harness((await seeded()).snapshot() as Record<string, string>);
    await run([...NEW, "--slug", "second"], more.deps);
    more.set("docs/ideas/0003-done.md", ideaText({ outcome: "confirmed" }));
    const text = harness(more.snapshot() as Record<string, string>);
    await run(["idea", "list"], text.deps);
    expect(text.out()).toBe(
      "0001 open Cache the probe results\n0002 open Cache the probe results\n0003 confirmed Done\n",
    );
    const json = harness(more.snapshot() as Record<string, string>);
    await run(["idea", "list", "--json"], json.deps);
    const parsed = JSON.parse(json.out()) as { slug: string }[];
    expect(parsed.map((i) => i.slug)).toEqual([
      "cache-the-probe-results",
      "second",
      "done",
    ]);
  });

  it("with no ideas prints nothing and succeeds", async () => {
    const h = harness();
    expect(await run(["idea", "list"], h.deps)).toBe(0);
    expect(h.out()).toBe("");
    const j = harness();
    await run(["idea", "list", "--json"], j.deps);
    expect(JSON.parse(j.out())).toEqual([]);
  });
});

describe("harness idea from a subdirectory", () => {
  it("finds the ideas through the repository root, not the working directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "harness-idea-"));
    try {
      await mkdir(join(root, "docs/ideas"), { recursive: true });
      await writeFile(join(root, "docs/index.md"), INDEX);
      await writeFile(join(root, "docs/ideas/0001-a.md"), ideaText({}, "A"));
      const out: string[] = [];
      const deps = {
        runner: new FakeRunner(),
        clock: { now: () => new Date("2026-03-04T00:00:00.000Z") },
        fs: nodeFileSystem,
        root: () => Promise.resolve(root),
        env: {},
        cwd: join(root, "docs"),
        ids: { next: () => "id-1" },
        stdin: () => Promise.resolve(""),
        stdout: (t: string) => out.push(t),
        stderr: () => undefined,
      };
      // The process working directory is the harness package, not the root.
      expect(process.cwd()).not.toBe(root);
      expect(await run(["idea", "list"], deps)).toBe(0);
      expect(out.join("")).toBe("0001 open A\n");
      expect(await run([...NEW, "--slug", "b"], deps)).toBe(0);
      expect(
        await nodeFileSystem.exists(join(root, "docs/ideas/0002-b.md")),
      ).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
