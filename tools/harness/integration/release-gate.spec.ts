// The release tag waits for the integration tier on the same commit (#404). The
// spec reads the real release workflow, since no cluster or process is needed.
// Docs: infra/plans/14-test-tiers.md (Step 4), ADR 0098.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const release = readFileSync(
  join(repo, ".github/workflows/release.yaml"),
  "utf8",
);

/** One top-level job of release.yaml: its name line through the lines before the next job. */
function jobBlock(name: string): string {
  const lines = release.split("\n");
  const start = lines.indexOf(`  ${name}:`);
  expect(start, `release.yaml has a job named ${name}`).toBeGreaterThanOrEqual(
    0,
  );
  const rest = lines.slice(start + 1);
  const next = rest.findIndex((line) => /^  \S/.test(line));
  const body = next === -1 ? rest : rest.slice(0, next);
  return [lines[start], ...body].join("\n");
}

/** The value of a job-level key, or undefined when the job does not set it. */
function jobKey(name: string, key: string): string | undefined {
  return new RegExp(`^    ${key}: (.+)$`, "m").exec(jobBlock(name))?.[1];
}

it("makes the release-please job, which creates the tag, wait for the integration job", () => {
  expect(jobKey("release-please", "needs")).toBe("integration");
});

it("runs the integration job on main only, so a push to main, and a dispatch from main, run the tier", () => {
  expect(jobKey("integration", "if")).toBe("github.ref == 'refs/heads/main'");
});

it("runs the whole integration tier in the integration job with read-only permissions", () => {
  const block = jobBlock("integration");

  expect(block).toMatch(/^        run: mise run test-integration$/m);
  expect(block).toMatch(/^      contents: read$/m);
  expect(block).not.toMatch(/: write$/m);
});

it("keeps release-please from running after a red integration job, never with always()", () => {
  const gate = jobKey("release-please", "if");

  expect(gate).toBe("github.ref == 'refs/heads/main'");
  expect(gate).not.toContain("always()");
});

it("leaves a green main releasing as before: release-please keeps its main gate, and dispatch still follows it", () => {
  expect(jobKey("dispatch", "needs")).toBe("release-please");
  expect(jobKey("dispatch", "if")).toContain(
    "needs.release-please.outputs.release_created == 'true'",
  );
});

it("keeps the tag-run signing jobs off the integration job, since no tag run starts the tier", () => {
  expect(jobKey("release", "needs")).toBeUndefined();
  expect(jobKey("release", "if")).toBe("github.ref_type == 'tag'");
});
