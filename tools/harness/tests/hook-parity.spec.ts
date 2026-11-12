import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { run, type CliDeps } from "../src/cli/index.js";
import { nodeFileSystem } from "../src/runtime/index.js";
import { FakeRunner } from "../src/runtime/runner-support.js";

const here = dirname(fileURLToPath(import.meta.url));
const hook = resolve(here, "../../../.claude/hooks/context.mjs");
const temp = mkdtempSync(join(tmpdir(), "harness-parity-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

const front = (status: string) =>
  `---\nstatus: ${status}\nsummary: A plan.\nlast-verified: 2026-11-07\n---\n\n`;

// Plan sets shaped like the cases in .claude/hooks/context.test.mjs for activePlans
// (frontmatter, legacy without frontmatter, none active); not the hook's own fixtures.
const fixtures: Record<string, Record<string, string>> = {
  frontmatter: {
    "1-initialize.md": `${front("done")}## Step 1: A\n\n- [ ] stale box\n`,
    "2-implementation.md": `${front("active")}## Step 9: B\n\n- [ ] open\n`,
    "3-agent-harness.md": `${front("done")}## Step 1: C\n\n- [x] done\n`,
    "4-knowledge.md": `${front("active")}## Step 1: D\n\n- [ ] open\n`,
  },
  legacy: {
    "1-old.md": "## Step 1: A\n\n- [ ] open\n",
    "2-older.md": "## Step 1: B\n\n- [ ] open\n",
    "3-closed.md": "## Step 1: C\n\n- [x] done\n",
    "4-new.md": `${front("active")}## Step 1: D\n\n- [ ] open\n`,
  },
  none: { "1-a.md": "- [x] done\n" },
};

function hookPlans(root: string): string[] {
  const script = `import(${JSON.stringify(hook)}).then(m=>console.log(JSON.stringify(m.activePlans(m.readPlans(${JSON.stringify(root)})))))`;
  return JSON.parse(
    execFileSync(process.execPath, ["-e", script], { encoding: "utf8" }),
  ) as string[];
}

async function harnessPlans(root: string): Promise<string[]> {
  let out = "";
  const deps: CliDeps = {
    runner: new FakeRunner(),
    clock: { now: () => new Date(0), sleep: () => Promise.resolve() },
    fs: nodeFileSystem,
    env: {},
    cwd: "/repo",
    root: () => Promise.resolve(root),
    ids: { next: () => "id-1" },
    stdin: () => Promise.resolve(""),
    stdout: (t) => (out += t),
    stderr: () => undefined,
  };
  await run(["plan", "active", "--json"], deps);
  return (JSON.parse(out) as { plans: { name: string }[] }).plans.map(
    (p) => p.name,
  );
}

describe("plan active parity with the context hook", () => {
  it.each(Object.keys(fixtures))(
    "picks the same plans, in the same order, on the %s fixtures",
    async (key) => {
      const root = join(temp, key);
      mkdirSync(join(root, "infra/plans"), { recursive: true });
      for (const [name, text] of Object.entries(fixtures[key] ?? {})) {
        writeFileSync(join(root, "infra/plans", name), text);
      }
      expect(await harnessPlans(root)).toEqual(hookPlans(root));
    },
  );

  it("picks the same plans, in the same order, over the real infra/plans", async () => {
    const repo = resolve(here, "../../..");
    const plans = await harnessPlans(repo);
    expect(plans.length).toBeGreaterThan(0);
    expect(plans).toEqual(hookPlans(repo));
  });
});
