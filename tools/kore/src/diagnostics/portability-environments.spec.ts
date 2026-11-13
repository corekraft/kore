import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, test } from "vitest";
import {
  findRoot,
  loadRepository,
  validateRepository,
} from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { validatePortability } from "./portability.js";

// Docs: docs/decisions/0012-environment-overlays-hold-provider-specifics.md
// Offline, credential-free proof across every environment directory in the
// repository (discovered, not listed, so a new environment is covered the day
// it is added): each validates, the application charts render identically, and
// selecting an environment swaps implementations only (Step 14).

const root = await findRoot();
// Skip git-ignored directories: the nightly job writes a scratch overlay of its
// own beside the environments (excluded through .git/info/exclude, a copy of
// `local`), which is neither a provider swap nor part of the contract. A new
// environment not yet `git add`ed is still checked.
function isIgnored(name: string): boolean {
  return (
    spawnSync(
      "git",
      ["check-ignore", "--quiet", "--", `infra/environments/${name}`],
      {
        cwd: root,
      },
    ).status === 0
  );
}

const environments = (
  await readdir(join(root, "infra/environments"), { withFileTypes: true })
)
  .filter((entry) => entry.isDirectory() && entry.name !== "common")
  .filter((entry) => !isIgnored(entry.name))
  .map((entry) => entry.name)
  .sort();

function recordingRunner() {
  const calls: string[] = [];
  const runner: Runner = {
    async run(command, args) {
      calls.push([command, ...args].join(" "));
      return { stdout: "kind: ConfigMap\n", stderr: "", code: 0 };
    },
  };
  return { runner, calls };
}

test("the repository ships a local and a provider environment", () => {
  assert.ok(environments.includes("local"));
  assert.ok(environments.length >= 2);
});

describe.each(environments)("environment %s", (name) => {
  test("validates offline without cluster or cloud credentials", async () => {
    const repository = await loadRepository(name);

    await validateRepository(repository);

    assert.equal(repository.environment.name, name);
  });

  test("renders application charts without any cluster call", async () => {
    const repository = await loadRepository(name);
    const { runner, calls } = recordingRunner();

    await validatePortability(repository, runner);

    assert.ok(calls.length > 0);
    assert.deepEqual(
      calls.filter((call) => !call.startsWith("helm template ")),
      [],
    );
    assert.deepEqual(
      calls.filter((call) => /--kube-context|--context/.test(call)),
      [],
    );
  });
});

describe("environment selection", () => {
  const providers = environments.filter((name) => name !== "local");

  test.each(providers)(
    "renders application charts identically in local and %s",
    async (provider) => {
      const local = recordingRunner();
      const other = recordingRunner();
      await validatePortability(await loadRepository("local"), local.runner);
      await validatePortability(await loadRepository(provider), other.runner);

      assert.deepEqual(other.calls, local.calls);
    },
  );

  test.each(providers)(
    "swaps platform implementations for %s through environment configuration only",
    async (provider) => {
      const local = await loadRepository("local");
      const other = await loadRepository(provider);

      // The same components in the same order: the contract is shared...
      assert.deepEqual(
        other.catalog.components.map(({ name }) => name),
        local.catalog.components.map(({ name }) => name),
      );
      // ...while every provider specific differs by environment alone.
      assert.notEqual(other.environment.provider, local.environment.provider);
      assert.notEqual(
        other.environment.registry.address,
        local.environment.registry.address,
      );
      assert.notDeepEqual(
        other.environment.componentValues?.["kore-platform-config"],
        local.environment.componentValues?.["kore-platform-config"],
      );
      assert.notDeepEqual(
        other.environment.componentValues?.["kore-image-policy"],
        local.environment.componentValues?.["kore-image-policy"],
      );
    },
  );
});
