import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

// Docs: infra/plans/2-implementation.md#step-13-complete-lifecycle-orchestration
// The live lifecycle proofs are never run by ordinary tests, so these checks
// read their sources to keep the guarantees that make them safe to run.

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("the destroy guard never purges data and gives --yes only to the throwaway profile", async () => {
  const support = await read("../cluster/destroy-guard-support.ts");
  const local = await read("../cluster/destroy-guard.integration.spec.ts");
  const cleanMachine = await read("./clean-machine.integration.spec.ts");
  for (const source of [support, local, cleanMachine]) {
    expect(source).not.toMatch(/["']--purge-data["']\s*[\],]/);
    expect(source).not.toMatch(/purgeData\s*:\s*true/);
  }
  // The shared helper refuses to run a flag set that purges data.
  expect(support).toContain('flags.includes("--purge-data")');
  // kore-local gets no --yes at all.
  expect(local).not.toMatch(/["']--yes["']/);
  expect(cleanMachine).toMatch(/flagSets: \[\[\], \["--yes"\]\]/);
});

test("the clean-machine script and spec delete only the throwaway profile", async () => {
  const script = await read("../../scripts/clean-machine-e2e.sh");
  const spec = await read("./clean-machine.integration.spec.ts");
  // The script never destroys anything itself: no kore-local environment is torn down.
  expect(script).not.toMatch(/local down|cluster destroy|minikube delete/);
  // The spec deletes the profile by constant, guarded as a throwaway.
  expect(spec).toContain("assertThrowawayProfile(cleanMachineProfile)");
  const deletes = spec.match(/"delete",\s*"--profile",\s*([^\],]+)/g) ?? [];
  expect(deletes.length).toBeGreaterThan(0);
  for (const del of deletes) {
    expect(del).toMatch(/cleanMachineProfile/);
  }
  expect(spec).toContain("KORE_ROOT: staged");
});

test("every lifecycle live spec is opt-in and has its own holding script", async () => {
  const { scripts } = JSON.parse(await read("../../package.json")) as {
    scripts: Record<string, string>;
  };
  for (const [script, file] of [
    ["clean-machine", "app/clean-machine.integration.spec"],
    ["destroy-guard", "cluster/destroy-guard.integration.spec"],
    ["reinstall", "app/reinstall.integration.spec"],
    ["app-status", "app/app-status.integration.spec"],
  ] as const) {
    expect(scripts[`test:integration:${script}`]).toContain(
      `dist/src/${file}.js`,
    );
  }
  for (const path of [
    "./clean-machine.integration.spec.ts",
    "../cluster/destroy-guard.integration.spec.ts",
    "./reinstall.integration.spec.ts",
    "./app-status.integration.spec.ts",
  ]) {
    expect(await read(path)).toContain("KORE_RUN_INTEGRATION");
  }
});
