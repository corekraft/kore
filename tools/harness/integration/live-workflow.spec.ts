// The manual live workflow runs ONE chosen test:live suite on demand. It is dispatch-only,
// offers only real suites, holds least permissions, pins every action by SHA, and shares the
// nightly's concurrency group so two live runs never overlap. Issue #623.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (path: string) => readFileSync(join(repo, path), "utf8");
const live = read(".github/workflows/live.yml");
const nightly = read(".github/workflows/nightly.yml");

const realSuites = Object.keys(
  (
    JSON.parse(read("tools/kore/package.json")) as {
      scripts: Record<string, string>;
    }
  ).scripts,
)
  .filter((name) => name.startsWith("test:live:"))
  .map((name) => name.slice("test:live:".length));

const options = (() => {
  const block =
    /^ {6}suite:\n(?:.*\n)*?^ {8}options:\n((?: {10}- .*\n)+)/m.exec(live)?.[1];
  return (block ?? "")
    .split("\n")
    .filter(Boolean)
    .map((line) => line.replace(/^ +- /, "").trim());
})();

it("runs on workflow_dispatch only, with no schedule, push or pull_request trigger", () => {
  expect(live).toMatch(/^on:\n {2}workflow_dispatch:\n {4}inputs:/m);
  expect(live).not.toMatch(/^ {2}(schedule|push|pull_request\w*):/m);
});

it("offers a choice input whose options are exactly the real test:live suites", () => {
  expect(live).toMatch(/^ {6}suite:\n(?:.*\n)*?^ {8}type: choice$/m);
  expect([...options].sort()).toEqual([...realSuites].sort());
  expect(options).toContain("footprint");
  expect(options).toContain("lifecycle");
  expect(live).toMatch(/^ {8}default: footprint$/m);
});

it("takes a number input runs, defaulting to 3, and checks its 2 to 5 range before any cluster work", () => {
  expect(live).toMatch(/^ {6}runs:\n(?:.*\n)*?^ {8}type: number$/m);
  expect(live).toMatch(/^ {6}runs:\n(?:.*\n)*?^ {8}default: 3$/m);
  expect(live).toMatch(/KORE_FOOTPRINT_RUNS: \$\{\{ inputs\.runs \}\}/);
  const check =
    /name: Check the runs input\n(?: {8}.*\n)+/.exec(live)?.[0] ?? "";
  expect(check).toMatch(/\[ "\$RUNS" -ge 2 \] && \[ "\$RUNS" -le 5 \]/);
  expect(live.indexOf("Check the runs input")).toBeLessThan(
    live.indexOf("run: tools/kore/scripts/nightly.sh"),
  );
});

it("offers the responsiveness suite", () => {
  expect(options).toContain("responsiveness");
});

it("holds read-only contents permission at the top and on the job, and nothing else", () => {
  const scopes = [...live.matchAll(/^ +(\w[\w-]*): (read|write|none)$/gm)];
  expect(scopes.length).toBeGreaterThan(0);
  expect(scopes.map((m) => `${m[1]}: ${m[2]}`)).toEqual(
    scopes.map(() => "contents: read"),
  );
  expect(live).not.toMatch(/id-token|packages: write/);
});

it("pins every action to the same commit SHA the nightly uses", () => {
  const uses = [...live.matchAll(/uses: (\S+)/g)].map((m) => m[1] as string);
  expect(uses.length).toBeGreaterThan(0);
  for (const use of uses) {
    expect(use).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
    expect(nightly).toContain(`uses: ${use} #`);
  }
});

it("shares the nightly concurrency group without cancelling a run in progress", () => {
  expect(nightly).toMatch(
    /^concurrency:\n {2}group: nightly\n {2}cancel-in-progress: false$/m,
  );
  expect(live).toMatch(
    /^concurrency:\n {2}group: nightly\n {2}cancel-in-progress: false$/m,
  );
});

it("runs the chosen suite through nightly.sh, which always tears down, and writes the output to the job summary", () => {
  expect(live).toMatch(
    /KORE_NIGHTLY_SUITES: test:live:\$\{\{ inputs\.suite \}\}/,
  );
  expect(live).toMatch(/run: tools\/kore\/scripts\/nightly\.sh/);
  expect(live).toMatch(/GITHUB_STEP_SUMMARY/);
  expect(live).toMatch(/^ {4}timeout-minutes: \d+$/m);
});

it("warns that a runner's numbers are not the local Now baseline", () => {
  const head = live.split("\nname:")[0] ?? "";
  expect(head).toMatch(/github-hosted runner/);
  expect(head).toMatch(/#614/);
  expect(head).toMatch(/#623/);
});
