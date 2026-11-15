// The workflow token-permission rules as a unit: each rule over workflow text,
// the parser under them, and the directory read over a typed fake file system.
// The real workflows and the hook run: integration/hook/workflow-permissions.spec.ts.
// Plan: infra/plans/2-implementation.md (Step 7), ADR 0044.

import { describe, expect, it } from "vitest";
import { CommandError } from "../runtime/index.js";
import {
  CI_ID_TOKEN,
  DOCS_WRITE_ALL,
  ISSUE_GATE,
  PARSE_SAMPLE,
  PUBLISH_PACKAGES,
  SIGNERS,
  TOP_BAD,
  fakeFs,
  issueJob,
  nightlyJob,
  notExact,
  port,
  readonly,
  release,
  sound,
} from "./workflow-permissions-support.js";
import {
  parseWorkflow,
  permissionProblems,
  workflowProblems,
} from "./workflow-permissions.js";

const nightly = (text: string) => permissionProblems({ "nightly.yml": text });

describe("permissionProblems: the release workflow", () => {
  it("accepts a tag-gated signing job beside a read-only job", () => {
    expect(
      permissionProblems({
        ...readonly("check.yml"),
        "release.yaml": release(),
      }),
    ).toEqual([]);
  });

  it.each(["pull_request", "pull_request_target"])(
    "refuses a %s trigger, which could mint a trusted signature",
    (trigger) => {
      const text = release().replace(
        "  workflow_dispatch:\n",
        `  workflow_dispatch:\n  ${trigger}:\n`,
      );
      expect(permissionProblems({ "release.yaml": text })).toEqual([
        `release.yaml: must not run on ${trigger}; a pull request could mint a trusted signature, so remove the trigger`,
      ]);
    },
  );

  it("refuses a signing job that runs without the tag gate", () => {
    expect(
      permissionProblems({
        "release.yaml": release({
          ifRelease: "github.ref == 'refs/heads/main'",
        }),
      }),
    ).toEqual([
      "release.yaml: signing job release must run only for tags; add `if: github.ref_type == 'tag'`",
    ]);
  });

  it("refuses a missing top-level permissions block, with the fix", () => {
    const text = release().replace(
      "permissions:\n  contents: read\njobs:",
      "jobs:",
    );
    expect(permissionProblems({ "release.yaml": text })).toEqual([
      "release.yaml: top-level permissions must be present and read-only; add `permissions: {}` or `contents: read`",
    ]);
  });

  it("refuses a job without explicit permissions, with the fix", () => {
    expect(
      permissionProblems({
        "release.yaml": release({ extra: "timeout-minutes: 5" }),
      }),
    ).toEqual([
      "release.yaml: job extra needs explicit permissions; add `permissions: {}` or the read scopes it uses",
    ]);
  });
});

describe("permissionProblems: signing jobs by name", () => {
  it("lets the charts job sign and push when it runs only for tags", () => {
    const text = release()
      .replace("  extra:", "  charts:")
      .replace(
        "contents: read\n    steps:\n      - run: echo hi\n",
        "contents: read\n      id-token: write\n      packages: write\n    steps:\n      - run: echo hi\n",
      )
      .replace("  charts:\n", "  charts:\n    if: github.ref_type == 'tag'\n");
    expect(permissionProblems({ "release.yaml": text })).toEqual([]);
  });

  it("refuses id-token write under a job name other than release, mirror or charts", () => {
    const text = release()
      .replace("  extra:", "  sneaky:")
      .replace(
        "contents: read\n    steps:\n      - run: echo hi\n",
        "contents: read\n      id-token: write\n    steps:\n      - run: echo hi\n",
      );
    expect(permissionProblems({ "release.yaml": text })).toEqual([
      `release.yaml: job sneaky requests id-token: write; ${SIGNERS}`,
    ]);
  });
});

describe("permissionProblems: the other workflows", () => {
  it("refuses id-token write in a pull_request workflow", () => {
    const text = CI_ID_TOKEN;
    expect(permissionProblems({ "ci.yml": text })).toEqual([
      `ci.yml: job build requests id-token: write; ${SIGNERS}`,
    ]);
  });

  it("refuses packages write outside release.yaml", () => {
    const text = PUBLISH_PACKAGES;
    expect(permissionProblems({ "publish.yml": text })).toEqual([
      `publish.yml: job push requests packages: write; ${SIGNERS}`,
    ]);
  });

  it("refuses a write-all top level and a contents write, outside release.yaml", () => {
    const text = DOCS_WRITE_ALL;
    expect(permissionProblems({ "docs.yml": text })).toEqual([
      "docs.yml: top-level permissions must be present and read-only; add `permissions: {}` or `contents: read`",
      "docs.yml: job a requests contents: write; only release.yaml may write, so drop it",
    ]);
  });
});

describe("permissionProblems: which job holds the nightly failure-issue scope", () => {
  it("accepts the job with exactly its scopes, after integration, on the scheduled main run", () => {
    expect(nightly(issueJob())).toEqual([]);
  });

  it("refuses the same scopes on any other job name in nightly.yml", () => {
    expect(nightly(issueJob({ name: "live" }))).toEqual([
      "nightly.yml: job live requests issues: write; only release.yaml may write, so drop it",
    ]);
  });

  it("refuses the failure-issue name in any other workflow file", () => {
    expect(permissionProblems({ "check.yml": issueJob() })).toEqual([
      "check.yml: job failure-issue requests issues: write; only release.yaml may write, so drop it",
    ]);
  });
});

describe("permissionProblems: the exact scopes of the nightly failure-issue job", () => {
  it("refuses an extra read scope on the named job", () => {
    const permissions =
      "      issues: write\n      actions: read\n      contents: read\n      pull-requests: read";
    expect(nightly(issueJob({ permissions }))).toEqual([
      notExact(
        "issues: write, actions: read, contents: read, pull-requests: read",
      ),
    ]);
  });
});

describe("permissionProblems: the needs and gate of the nightly failure-issue job", () => {
  it("refuses the named job without needs: integration", () => {
    expect(nightly(issueJob({ needs: null }))).toEqual([
      "nightly.yml: job failure-issue must wait for the integration job; add `needs: integration`",
    ]);
  });

  it("refuses the named job without the scheduled main gate", () => {
    expect(
      nightly(issueJob({ gate: "github.ref == 'refs/heads/main'" })),
    ).toEqual([
      `nightly.yml: job failure-issue must run on the scheduled main run, after a failure or success; add \`if: ${ISSUE_GATE}\``,
    ]);
  });

  it("refuses a write scope beyond issues on the named job", () => {
    expect(
      nightly(
        issueJob({
          permissions: "      issues: write\n      contents: write",
        }),
      ),
    ).toEqual([notExact("issues: write, contents: write")]);
  });

  it("refuses a top-level permissions write in nightly.yml, with the top-level fix", () => {
    expect(nightly(nightlyJob(sound(), { top: "permissions: write" }))).toEqual(
      [TOP_BAD],
    );
  });

  it("refuses write-all on the named job, naming what it asked for", () => {
    expect(
      nightly(nightlyJob(sound({ permissions: "    permissions: write-all" }))),
    ).toEqual([notExact("write-all")]);
  });
});

describe("permissionProblems: the top-level and look-alike rules of nightly.yml", () => {
  it("refuses flow-style permissions on the named job, naming the flow text", () => {
    expect(
      nightly(
        nightlyJob(
          sound({
            permissions:
              "    permissions: { issues: write, actions: read, contents: read }",
          }),
        ),
      ),
    ).toEqual([notExact("{ issues: write, actions: read, contents: read }")]);
  });

  it("refuses an upper-case look-alike of the named job as an ordinary write", () => {
    expect(nightly(nightlyJob(sound(), { name: "Failure-Issue" }))).toEqual([
      "nightly.yml: job Failure-Issue requests issues: write; only release.yaml may write, so drop it",
    ]);
  });

  it("refuses a longer look-alike of the named job as an ordinary write", () => {
    expect(nightly(nightlyJob(sound(), { name: "failure-issue-2" }))).toEqual([
      "nightly.yml: job failure-issue-2 requests issues: write; only release.yaml may write, so drop it",
    ]);
  });

  it("refuses a top-level write-all in nightly.yml, with the top-level fix", () => {
    expect(
      nightly(nightlyJob(sound(), { top: "permissions: write-all" })),
    ).toEqual([TOP_BAD]);
  });

  it.each([
    ["id-token", "id-token: write"],
    ["packages", "packages: write"],
    ["pull-requests", "pull-requests: write"],
  ])("refuses %s write on the named job", (_scope, line) => {
    const permissions = `    permissions:\n      issues: write\n      actions: read\n      contents: read\n      ${line}`;
    expect(nightly(nightlyJob(sound({ permissions })))).toEqual([
      notExact(`issues: write, actions: read, contents: read, ${line}`),
    ]);
  });

  it.each([
    ["a flow list", "[integration, live]"],
    ["a block list", "\n      - integration"],
    ["another job", "live"],
  ])("refuses needs as %s: it must be exactly integration", (_form, needs) => {
    expect(nightly(nightlyJob(sound({ needs })))).toEqual([
      "nightly.yml: job failure-issue must wait for the integration job; add `needs: integration`",
    ]);
  });
});

describe("parseWorkflow", () => {
  it("reads nested keys and flow values, dropping comments, list items and block scalars", () => {
    const text = PARSE_SAMPLE;
    expect(parseWorkflow(text)).toEqual({
      name: "x",
      on: { push: { branches: "[main]" } },
      permissions: "{}",
      jobs: { build: { run: "|", steps: {} } },
    });
  });
});

describe("workflowProblems: the workflows directory", () => {
  const dir = "/repo/.github/workflows";
  const faultOf = (code: string) => Object.assign(new Error(code), { code });

  it("checks only .yml and .yaml files, in name order, and reports their problems", async () => {
    const fake = fakeFs();
    const texts: Record<string, string> = {
      [`${dir}/check.yml`]: readonly("check.yml")["check.yml"] ?? "",
      [`${dir}/release.yaml`]: release({ ifRelease: "github.ref == 'x'" }),
    };
    fake.readdir.mockResolvedValue(["notes.md", "release.yaml", "check.yml"]);
    fake.readFile.mockImplementation((path) =>
      Promise.resolve(texts[path] ?? ""),
    );
    expect(await workflowProblems(port(fake), "/repo")).toEqual([
      "release.yaml: signing job release must run only for tags; add `if: github.ref_type == 'tag'`",
    ]);
    expect(fake.readFile.mock.calls).toEqual([
      [`${dir}/check.yml`],
      [`${dir}/release.yaml`],
    ]);
  });

  it("names the fix when the workflows directory is missing", async () => {
    const fake = fakeFs();
    fake.readdir.mockRejectedValue(faultOf("ENOENT"));
    await expect(workflowProblems(port(fake), "/repo")).rejects.toEqual(
      new CommandError(
        `No workflows directory at ${dir}. Run from the repository, or set CLAUDE_PROJECT_DIR to its root.`,
      ),
    );
  });

  it("rethrows a read fault that is not a missing directory", async () => {
    const fake = fakeFs();
    fake.readdir.mockRejectedValue(faultOf("EACCES"));
    await expect(workflowProblems(port(fake), "/repo")).rejects.toThrow(
      "EACCES",
    );
  });
});
