import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { loadRepository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { platformRender } from "./render.js";

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
