import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { loadRepository } from "../../src/config/index.js";
import type { Runner } from "../../src/runtime/index.js";
import { platformRender } from "../../src/testing/index.js";

// Real units together: the catalog loader, Helm's output redaction and the
// filesystem. Moved from src/platform/render-output.spec.ts (ADR 0098).

const rendered =
  "apiVersion: v1\nkind: Secret\nmetadata:\n  name: db\nstringData:\n  password: hunter2-plain\n";

test("platform render never writes Secret values to the output directory", async () => {
  const base = await loadRepository("local");
  const root = await mkdtemp(join(tmpdir(), "kore-render-redaction-"));
  const component = base.catalog.components.find(
    ({ kind }) => kind === "helm",
  )!;
  const repository = {
    ...base,
    root,
    catalog: {
      ...base.catalog,
      components: [{ ...component, dependencies: [] }],
    },
  };
  const runner: Runner = {
    async run(command) {
      return {
        stdout: command === "helm" ? rendered : "",
        stderr: "",
        code: 0,
      };
    },
  };
  try {
    await platformRender(repository, runner, "rendered");
    const written = await readFile(
      join(root, "rendered", `${component.name}.yaml`),
      "utf8",
    );
    assert.ok(!written.includes("hunter2-plain"));
    assert.match(written, /password: <redacted>/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("platform render validates a manifest component with a client dry-run and never renders it through Helm", async () => {
  const base = await loadRepository("local");
  const manifest = base.catalog.components.find(
    ({ kind }) => kind === "manifest",
  )!;
  const repository = {
    ...base,
    catalog: {
      ...base.catalog,
      components: [{ ...manifest, dependencies: [] }],
    },
  };
  const calls: string[][] = [];
  const runner: Runner = {
    async run(command, args) {
      calls.push([command, ...args]);
      return { stdout: "", stderr: "", code: 0 };
    },
  };
  await platformRender(repository, runner);
  assert.deepEqual(
    calls.map(([command]) => command),
    ["kubectl"],
  );
  assert.ok(calls[0]!.includes("--dry-run=client"));
  assert.ok(calls[0]!.includes("--recursive"));
});
