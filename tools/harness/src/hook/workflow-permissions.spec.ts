// Signer guard: only release.yaml's tag-gated signing jobs may hold id-token or
// packages write. Plan: infra/plans/2-implementation.md (Step 7), ADR 0044.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { run } from "../cli/index.js";
import { testHarness } from "../cli/cli-support.js";
import { CommandError, nodeFileSystem } from "../runtime/index.js";
import { permissionProblems } from "./workflow-permissions.js";

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

const readonly = (name: string, extra = "") => ({
  [name]: `name: x
on:
  pull_request:
permissions:
  contents: read
jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
${extra}    steps:
      - run: echo hi
`,
});

const release = (
  over: { ifRelease?: string; extra?: string } = {},
) => `name: release
on:
  push:
    tags: ["v[0-9]+.[0-9]+.[0-9]+"]
  workflow_dispatch:
permissions:
  contents: read
jobs:
  release:
    if: ${over.ifRelease ?? "github.ref_type == 'tag'"}
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
      id-token: write
    steps:
      - run: echo sign
  extra:
    runs-on: ubuntu-latest
    ${over.extra ?? "permissions:\n      contents: read"}
    steps:
      - run: echo hi
`;

describe("permissionProblems accepts", () => {
  it("a tag-gated release workflow with explicit permissions", () => {
    expect(
      permissionProblems({
        ...readonly("check.yml"),
        "release.yaml": release(),
      }),
    ).toEqual([]);
  });
});

describe("permissionProblems rejects", () => {
  it("id-token write in a pull_request workflow", () => {
    const problems = permissionProblems({
      "ci.yml": `on:
  pull_request:
permissions: {}
jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
    steps:
      - run: echo hi
`,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(
      /ci\.yml.*build.*id-token: write.*release\.yaml/s,
    );
  });

  it("a job without explicit permissions", () => {
    const problems = permissionProblems({
      "release.yaml": release({ extra: "timeout-minutes: 5" }),
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/release\.yaml.*extra.*explicit permissions/s);
  });

  it("a non-release workflow requesting packages write", () => {
    const problems = permissionProblems({
      "publish.yml": `on:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  push:
    runs-on: ubuntu-latest
    permissions:
      packages: write
    steps:
      - run: echo hi
`,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/publish\.yml.*push.*packages: write/s);
  });

  it("any other write scope in a non-release workflow", () => {
    const problems = permissionProblems({
      "docs.yml": `on:
  push:
permissions: write-all
jobs:
  a:
    runs-on: ubuntu-latest
    permissions: { contents: write }
    steps:
      - run: echo hi
`,
    });
    expect(problems).toHaveLength(2);
  });
});

describe("permissionProblems rejects signing that escapes its gate", () => {
  it("a signing job that can run on a pull request", () => {
    for (const trigger of ["pull_request", "pull_request_target"]) {
      const text = release().replace(
        "  workflow_dispatch:\n",
        `  workflow_dispatch:\n  ${trigger}:\n`,
      );
      const problems = permissionProblems({ "release.yaml": text });
      expect(
        problems.some((p) => p.includes(trigger)),
        trigger,
      ).toBe(true);
    }
  });

  it("a signing job without the tag gate", () => {
    const problems = permissionProblems({
      "release.yaml": release({ ifRelease: "github.ref == 'refs/heads/main'" }),
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/release.*github\.ref_type == 'tag'/s);
  });

  it("a signing job name other than release or mirror", () => {
    const text = release()
      .replace("  extra:", "  sneaky:")
      .replace(
        "contents: read\n    steps:\n      - run: echo hi\n",
        "contents: read\n      id-token: write\n    steps:\n      - run: echo hi\n",
      );
    const problems = permissionProblems({ "release.yaml": text });
    expect(problems.some((p) => /sneaky.*id-token: write/s.test(p))).toBe(true);
  });

  it("a missing or writable top-level permissions block", () => {
    const text = release().replace(
      "permissions:\n  contents: read\njobs:",
      "jobs:",
    );
    expect(permissionProblems({ "release.yaml": text })[0]).toMatch(
      /top-level permissions/,
    );
  });
});

describe("hook workflow-permissions", () => {
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

  it("passes silently for the repository's workflows", async () => {
    const h = testHarness();
    h.deps.fs = nodeFileSystem;
    h.deps.root = () => Promise.resolve(repo);
    expect(await run(["hook", "workflow-permissions"], h.deps)).toBe(0);
    expect(h.err()).toBe("");
    expect(
      await nodeFileSystem.exists(join(repo, ".github/workflows/release.yaml")),
    ).toBe(true);
  });

  it("passes silently and ignores stdin for compliant workflows", async () => {
    expect(
      await hook(
        {
          ...wf("release.yaml", release()),
          ...wf("check.yml", readonly("x")["x"] ?? ""),
        },
        [],
        '{"tool_name":"Bash"}',
      ),
    ).toEqual({ code: 0, out: "", err: "" });
  });

  it("reports each problem with its fix on stderr and exits 1", async () => {
    const result = await hook(
      wf("release.yaml", release({ ifRelease: "github.ref == 'x'" })),
    );
    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(result.err).toBe(
      "release.yaml: signing job release must run only for tags; add `if: github.ref_type == 'tag'`\n",
    );
  });

  it("reads only .yml and .yaml files", async () => {
    expect(
      await hook({
        ...wf("release.yaml", release()),
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
    const result = { err: h.err() };
    expect(result.err).toMatch(
      /^\[hook:workflow-permissions\] failed open: No workflows directory at .*workflows\. Run from the repository, or set CLAUDE_PROJECT_DIR to its root\.\n$/,
    );
  });

  it("fails closed under --strict when it cannot run", async () => {
    const h = testHarness();
    h.deps.fs = nodeFileSystem;
    h.deps.root = () => Promise.resolve(emptyRoot());
    expect(
      await run(["hook", "workflow-permissions", "--strict"], h.deps),
    ).toBe(1);
    expect(h.err()).toContain("[hook:workflow-permissions] failed:");
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
