// Signer guard: only release.yaml's tag-gated signing jobs may hold id-token or
// packages write. Plan: infra/plans/2-implementation.md (Step 7), ADR 0044.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { permissionProblems } from "./workflow-permissions.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dir = join(root, ".github", "workflows");

const readonly = (name, extra = "") => ({
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

const release = (over = {}) => `name: release
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

test("the repository's workflows satisfy the signer guard", () => {
  const files = Object.fromEntries(
    readdirSync(dir)
      .filter((f) => /\.ya?ml$/.test(f))
      .map((f) => [f, readFileSync(join(dir, f), "utf8")]),
  );
  assert.ok("release.yaml" in files);
  assert.deepEqual(permissionProblems(files), []);
});

test("a tag-gated release workflow with explicit permissions passes", () => {
  assert.deepEqual(
    permissionProblems({ ...readonly("check.yml"), "release.yaml": release() }),
    [],
  );
});

test("id-token write in a pull_request workflow is rejected", () => {
  const files = {
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
  };
  const problems = permissionProblems(files);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /ci\.yml.*build.*id-token: write.*release\.yaml/s);
});

test("a job without explicit permissions is rejected", () => {
  const problems = permissionProblems({
    "release.yaml": release({ extra: "timeout-minutes: 5" }),
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /release\.yaml.*extra.*explicit permissions/s);
});

test("a non-release workflow requesting packages write is rejected", () => {
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
  assert.equal(problems.length, 1);
  assert.match(problems[0], /publish\.yml.*push.*packages: write/s);
});

test("any other write scope in a non-release workflow is rejected", () => {
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
  assert.equal(problems.length, 2);
});

test("a signing job that can run on a pull request is rejected", () => {
  for (const trigger of ["pull_request", "pull_request_target"]) {
    const text = release().replace(
      "  workflow_dispatch:\n",
      `  workflow_dispatch:\n  ${trigger}:\n`,
    );
    const problems = permissionProblems({ "release.yaml": text });
    assert.ok(
      problems.some((p) => p.includes(trigger)),
      trigger,
    );
  }
});

test("a signing job without the tag gate is rejected", () => {
  const problems = permissionProblems({
    "release.yaml": release({ ifRelease: "github.ref == 'refs/heads/main'" }),
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /release.*github\.ref_type == 'tag'/s);
});

test("a signing job name other than release or mirror is rejected", () => {
  const text = release()
    .replace("  extra:", "  sneaky:")
    .replace(
      "contents: read\n    steps:\n      - run: echo hi\n",
      "contents: read\n      id-token: write\n    steps:\n      - run: echo hi\n",
    );
  const problems = permissionProblems({ "release.yaml": text });
  assert.ok(problems.some((p) => /sneaky.*id-token: write/s.test(p)));
});

test("a missing or writable top-level permissions block is rejected", () => {
  const text = release().replace(
    "permissions:\n  contents: read\njobs:",
    "jobs:",
  );
  assert.match(
    permissionProblems({ "release.yaml": text })[0],
    /top-level permissions/,
  );
});
