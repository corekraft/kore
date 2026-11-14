// Workflow YAML fixtures for the workflow-permissions specs: data only, so the
// unit spec and the integration spec read the same shapes.

import { vi } from "vitest";
import type { FileSystem } from "../runtime/index.js";

export const ISSUE_GATE =
  "always() && (github.event_name == 'schedule' || github.event_name == 'workflow_dispatch') && github.ref == 'refs/heads/main'";

export const TOP_READ = "permissions:\n  contents: read";

/** A release.yaml with a tag-gated signing job and a plain extra job; each part is overridable. */
export const release = (
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

/** A workflow with one read-only job, so a file that is only checked, not signed. */
export const readonly = (name: string) => ({
  [name]: `name: x
on:
  pull_request:
${TOP_READ}
jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - run: echo hi
`,
});

/** A nightly.yml with one job: `body` is the job's lines after its name, verbatim. */
export const nightlyJob = (
  body: string,
  options: { top?: string; name?: string } = {},
) => `name: nightly
on:
  schedule:
    - cron: "17 3 * * *"
${options.top ?? TOP_READ}
jobs:
  ${options.name ?? "failure-issue"}:
${body}    steps:
      - run: echo report
`;

/** The failure-issue job's lines, with each part overridable. */
export const sound = (
  over: { needs?: string; gate?: string; permissions?: string } = {},
) =>
  [
    `    needs: ${over.needs ?? "integration"}`,
    `    if: ${over.gate ?? ISSUE_GATE}`,
    "    runs-on: ubuntu-latest",
    over.permissions ??
      "    permissions:\n      issues: write\n      actions: read\n      contents: read",
    "",
  ].join("\n");

/** The nightly failure-issue job as a whole nightly.yml, with each field overridable. `null` omits the field. */
export const issueJob = (
  over: {
    name?: string;
    needs?: string | null;
    gate?: string | null;
    permissions?: string;
  } = {},
) =>
  nightlyJob(
    [
      `    ${over.needs === null ? "" : `needs: ${over.needs ?? "integration"}`}`,
      `    ${over.gate === null ? "" : `if: ${over.gate ?? ISSUE_GATE}`}`,
      "    runs-on: ubuntu-latest",
      "    permissions:",
      over.permissions ??
        "      issues: write\n      actions: read\n      contents: read",
    ].join("\n") + "\n",
    over.name === undefined ? {} : { name: over.name },
  );

/** Workflow text for the other-workflows rules. */
export const CI_ID_TOKEN = `on:
  pull_request:
permissions: {}
jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
    steps:
      - run: echo hi
`;

/** Workflow text for the other-workflows rules. */
export const PUBLISH_PACKAGES = `on:
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
`;

/** Workflow text for the other-workflows rules. */
export const DOCS_WRITE_ALL = `on:
  push:
permissions: write-all
jobs:
  a:
    runs-on: ubuntu-latest
    permissions: { contents: write }
    steps:
      - run: echo hi
`;

export const TOP_BAD =
  "nightly.yml: top-level permissions must be present and read-only; add `permissions: {}` or `contents: read`";
export const SIGNERS =
  "only the release and mirror jobs of release.yaml may sign or push, so drop it";
export const WANT = "issues: write, actions: read, contents: read";
/** The problem for a failure-issue job that does not request exactly its scopes. */
export const notExact = (got: string) =>
  `nightly.yml: job failure-issue requests ${got}; it must request exactly ${WANT}, so drop the rest`;

/** A typed file system whose two reads the directory check makes are mocks. */
export function fakeFs() {
  return {
    readdir: vi.fn<FileSystem["readdir"]>(),
    readFile: vi.fn<FileSystem["readFile"]>(),
  };
}

/** The fake as the file system the check reads through; only the two reads are mocked, so the one assertion stands for the rest. */
export function port(fake: ReturnType<typeof fakeFs>): FileSystem {
  const used: Pick<FileSystem, "readdir" | "readFile"> = fake;
  return used as FileSystem;
}

/** A workflow with comments, a flow value, a list item and a block scalar, for the parser. */
export const PARSE_SAMPLE = `name: x # the workflow
on:
  push:
    branches: [main]
permissions: {}
jobs:
  # a comment line
  build:
    run: |
      echo hi
    steps:
      - run: echo
`;
