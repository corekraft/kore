import { describe, expect, it } from "vitest";
import { run, type CliDeps } from "../cli/index.js";
import { FakeRunner } from "../runtime/runner-support.js";

const ROOT = "/repo";

function harness(files: Record<string, string>) {
  const out: string[] = [];
  const err: string[] = [];
  const deps: CliDeps = {
    runner: new FakeRunner(),
    clock: { now: () => new Date("2026-01-02T03:04:05.000Z") },
    fs: {
      readFile: (path) => {
        const key = path.slice(ROOT.length + 1);
        return path.startsWith(`${ROOT}/`) && key in files
          ? Promise.resolve(files[key] ?? "")
          : Promise.reject(new Error(`ENOENT ${path}`));
      },
      writeFile: () => Promise.resolve(),
      exists: () => Promise.resolve(true),
      readdir: (path) =>
        path === `${ROOT}/infra/plans`
          ? Promise.resolve(
              Object.keys(files).map((f) => f.slice("infra/plans/".length)),
            )
          : Promise.reject(
              Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
            ),
    },
    env: {},
    cwd: "/repo",
    root: () => Promise.resolve(ROOT),
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
  };
  return { deps, out: () => out.join(""), err: () => err.join("") };
}

const active = (body: string) =>
  `---\nstatus: active\nsummary: s\nlast-verified: 2026-11-11\n---\n\n${body}`;

describe("harness plan active", () => {
  it("lists every active plan as JSON and flags the highest-numbered as the default", async () => {
    const h = harness({
      "infra/plans/2-a.md": active(
        "## Step 1: A\n\n- [ ] x\n- [ ] y\n\n## Step 2: B\n\nNext: go.\n\n- [ ] z\n",
      ),
      "infra/plans/9-b.md": active("## Step 1: C\n\n- [ ] q\n"),
      "infra/plans/3-c.md":
        "---\nstatus: done\n---\n## Step 1\n\n- [ ] stale\n",
    });
    expect(await run(["plan", "active", "--json"], h.deps)).toBe(0);
    expect(JSON.parse(h.out())).toEqual({
      default: "9-b.md",
      plans: [
        {
          file: "infra/plans/9-b.md",
          name: "9-b.md",
          default: true,
          open: [{ step: "Step 1", count: 1 }],
          next: null,
          upcoming: [],
        },
        {
          file: "infra/plans/2-a.md",
          name: "2-a.md",
          default: false,
          open: [
            { step: "Step 1", count: 2 },
            { step: "Step 2", count: 1 },
          ],
          next: { step: "Step 2: B", text: "go." },
          upcoming: [],
        },
      ],
    });
  });

  it("prints text naming the default plan", async () => {
    const h = harness({
      "infra/plans/9-b.md": active("## Step 1: C\n\n- [ ] q\n"),
    });
    expect(await run(["plan", "active"], h.deps)).toBe(0);
    expect(h.out()).toContain("infra/plans/9-b.md (default)");
    expect(h.out()).toContain("Step 1 (1)");
  });

  it("says plainly that no plan is active, with exit 0 and JSON of an empty list", async () => {
    const text = harness({
      "infra/plans/1-a.md": "---\nstatus: done\n---\n- [x] d\n",
    });
    expect(await run(["plan", "active"], text.deps)).toBe(0);
    expect(text.out()).toContain("No active plan");

    const json = harness({});
    expect(await run(["plan", "active", "--json"], json.deps)).toBe(0);
    expect(JSON.parse(json.out())).toEqual({ default: null, plans: [] });
  });
});

describe("harness plan active edge cases", () => {
  it("treats a missing plans directory as no active plan", async () => {
    const h = harness({});
    h.deps.fs.readdir = () =>
      Promise.reject(Object.assign(new Error("gone"), { code: "ENOENT" }));
    expect(await run(["plan", "active"], h.deps)).toBe(0);
    expect(h.out()).toContain("No active plan");
  });

  it("rethrows unexpected read errors instead of hiding them", async () => {
    const h = harness({});
    h.deps.fs.readdir = () =>
      Promise.reject(Object.assign(new Error("denied"), { code: "EACCES" }));
    await expect(run(["plan", "active"], h.deps)).rejects.toThrow("denied");
  });

  it("prints the Next: line and upcoming steps in text", async () => {
    const h = harness({
      "infra/plans/2-a.md": active(
        "## Step 1: A\n\nNext: go.\n\n- [ ] x\n\n## Step 2: B\n\n- [ ] y\n",
      ),
    });
    await run(["plan", "active"], h.deps);
    expect(h.out()).toContain("Next (Step 1: A): go.");
    expect(h.out()).toContain("Upcoming: Step 2: B");
  });
});
