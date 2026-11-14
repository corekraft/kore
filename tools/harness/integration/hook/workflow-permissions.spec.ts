// Workflow permissions over the real repository's workflows, the real file
// system and the real hook dispatcher. The unit spec at
// src/hook/workflow-permissions.spec.ts checks the rules on workflow text.
// Plan: infra/plans/2-implementation.md (Step 7), ADR 0044.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { run } from "../../src/cli/index.js";
import { CommandError, nodeFileSystem } from "../../src/runtime/index.js";
import { releaseWorkflow, testHarness } from "../../src/testing/index.js";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function emptyRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "kore-workflows-empty-"));
  temps.push(root);
  return root;
}

async function hook(
  files: Record<string, string>,
  argv: string[] = [],
  stdin = "",
) {
  const h = testHarness({ files });
  h.deps.stdin = () => Promise.resolve(stdin);
  const code = await run(["hook", "workflow-permissions", ...argv], h.deps);
  return { code, out: h.out(), err: h.err() };
}

const wf = (name: string, text: string) => ({
  [`/repo/.github/workflows/${name}`]: text,
});

describe("hook workflow-permissions, on the repository", () => {
  it("passes silently for the repository's own workflows", async () => {
    const h = testHarness();
    h.deps.fs = nodeFileSystem;
    h.deps.root = () => Promise.resolve(repo);
    expect(await run(["hook", "workflow-permissions"], h.deps)).toBe(0);
    expect(h.out()).toBe("");
    expect(h.err()).toBe("");
    expect(
      await nodeFileSystem.exists(join(repo, ".github/workflows/release.yaml")),
    ).toBe(true);
  });
});

describe("hook workflow-permissions, with workflows", () => {
  it("passes silently and ignores stdin for compliant workflows", async () => {
    expect(
      await hook(
        wf("release.yaml", releaseWorkflow()),
        [],
        '{"tool_name":"Bash"}',
      ),
    ).toEqual({ code: 0, out: "", err: "" });
  });

  it("reports each problem with its fix on stderr and exits 1", async () => {
    const result = await hook(
      wf("release.yaml", releaseWorkflow({ ifRelease: "github.ref == 'x'" })),
    );
    expect(result).toEqual({
      code: 1,
      out: "",
      err: "release.yaml: signing job release must run only for tags; add `if: github.ref_type == 'tag'`\n",
    });
  });

  it("reads only .yml and .yaml files", async () => {
    expect(
      await hook({
        ...wf("release.yaml", releaseWorkflow()),
        ...wf("notes.md", "permissions: write-all"),
      }),
    ).toEqual({ code: 0, out: "", err: "" });
  });
});

describe("hook workflow-permissions fails open", () => {
  it("fails open, with the fix, when .github/workflows is missing", async () => {
    const h = testHarness();
    h.deps.fs = nodeFileSystem;
    h.deps.root = () => Promise.resolve(emptyRoot());
    expect(await run(["hook", "workflow-permissions"], h.deps)).toBe(0);
    expect(h.out()).toBe("");
    expect(h.err()).toMatch(
      /^\[hook:workflow-permissions\] failed open: No workflows directory at .*workflows\. Run from the repository, or set CLAUDE_PROJECT_DIR to its root\.\n$/,
    );
  });

  it("fails closed under --strict when it cannot run", async () => {
    const h = testHarness();
    h.deps.fs = nodeFileSystem;
    const root = emptyRoot();
    h.deps.root = () => Promise.resolve(root);
    expect(
      await run(["hook", "workflow-permissions", "--strict"], h.deps),
    ).toBe(1);
    expect(h.out()).toBe("");
    expect(h.err()).toBe(
      `[hook:workflow-permissions] failed: No workflows directory at ${join(root, ".github", "workflows")}. Run from the repository, or set CLAUDE_PROJECT_DIR to its root.\n`,
    );
  });

  it("fails open when the root cannot be found", async () => {
    const h = testHarness();
    h.deps.root = () =>
      Promise.reject(new CommandError('CLAUDE_PROJECT_DIR is "/nope".'));
    expect(await run(["hook", "workflow-permissions"], h.deps)).toBe(0);
    expect(h.err()).toBe(
      '[hook:workflow-permissions] failed open: CLAUDE_PROJECT_DIR is "/nope".\n',
    );
  });

  it("fails open, flagging an unexpected read fault as the harness's to fix", async () => {
    const h = testHarness();
    h.deps.fs = {
      ...h.deps.fs,
      readdir: () => Promise.resolve(["release.yaml"]),
      readFile: () =>
        Promise.reject(Object.assign(new Error("denied"), { code: "EACCES" })),
    };
    expect(await run(["hook", "workflow-permissions"], h.deps)).toBe(0);
    expect(h.err()).toBe(
      "[hook:workflow-permissions] failed open: denied (unexpected; fixing it is on the harness)\n",
    );
  });
});
