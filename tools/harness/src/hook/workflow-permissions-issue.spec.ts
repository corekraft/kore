// The one named nightly job allowed a write scope (issue #419, ADR 0044): the
// failure-issue job of nightly.yml, and nothing else outside release.yaml.

import { describe, expect, it } from "vitest";
import { permissionProblems } from "./workflow-permissions.js";

const ISSUE_GATE =
  "always() && (github.event_name == 'schedule' || github.event_name == 'workflow_dispatch') && github.ref == 'refs/heads/main'";

/** The nightly failure-issue job, with each field overridable. `null` omits the field. */
const issueJob = (
  over: {
    name?: string;
    needs?: string | null;
    gate?: string | null;
    permissions?: string;
  } = {},
) => `name: nightly
on:
  schedule:
    - cron: "17 3 * * *"
permissions:
  contents: read
jobs:
  ${over.name ?? "failure-issue"}:
    ${over.needs === null ? "" : `needs: ${over.needs ?? "integration"}`}
    ${over.gate === null ? "" : `if: ${over.gate ?? ISSUE_GATE}`}
    runs-on: ubuntu-latest
    permissions:
${over.permissions ?? "      issues: write\n      actions: read\n      contents: read"}
    steps:
      - run: echo report
`;

describe("permissionProblems grants issues: write to one named nightly job", () => {
  it("accepts the failure-issue job with exactly its scopes, after the integration job, on the scheduled main run", () => {
    expect(permissionProblems({ "nightly.yml": issueJob() })).toEqual([]);
  });

  it("refuses the same permissions on any other job name", () => {
    const problems = permissionProblems({
      "nightly.yml": issueJob({ name: "live" }),
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/nightly\.yml.*live.*issues: write/s);
  });

  it("refuses the failure-issue name in any other workflow file", () => {
    const problems = permissionProblems({ "check.yml": issueJob() });
    expect(problems.some((p) => /check\.yml.*issues: write/s.test(p))).toBe(
      true,
    );
  });

  it("refuses an extra scope on the named job, even a read one", () => {
    const problems = permissionProblems({
      "nightly.yml": issueJob({
        permissions:
          "      issues: write\n      actions: read\n      contents: read\n      pull-requests: read",
      }),
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/failure-issue.*pull-requests/s);
  });

  it("refuses the named job without needs: integration", () => {
    const problems = permissionProblems({
      "nightly.yml": issueJob({ needs: null }),
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/failure-issue.*needs: integration/s);
  });

  it("refuses the named job without the always() scheduled-main gate", () => {
    const problems = permissionProblems({
      "nightly.yml": issueJob({ gate: "github.ref == 'refs/heads/main'" }),
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/failure-issue.*always\(\)/s);
  });

  it("refuses the named job when it asks for a write scope beyond issues", () => {
    const problems = permissionProblems({
      "nightly.yml": issueJob({
        permissions: "      issues: write\n      contents: write",
      }),
    });
    expect(
      problems.some((p) => /failure-issue.*contents: write/s.test(p)),
    ).toBe(true);
  });
});

const WANT = "issues: write, actions: read, contents: read";
const notExact = (got: string) =>
  `nightly.yml: job failure-issue requests ${got}; it must request exactly ${WANT}, so drop the rest`;
const TOP_READ = "permissions:\n  contents: read";
const TOP_BAD =
  "nightly.yml: top-level permissions must be present and read-only; add `permissions: {}` or `contents: read`";

/** A nightly.yml with one job: `body` is the job's lines after its name, verbatim. */
const nightlyJob = (
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
const sound = (
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

describe("permissionProblems refuses every other way to hold the nightly scope", () => {
  it("refuses a top-level permissions: write in nightly.yml, with the top-level fix", () => {
    expect(
      permissionProblems({
        "nightly.yml": nightlyJob(sound(), { top: "permissions: write" }),
      }),
    ).toEqual([TOP_BAD]);
  });

  it("refuses a top-level permissions: write-all in nightly.yml, with the top-level fix", () => {
    expect(
      permissionProblems({
        "nightly.yml": nightlyJob(sound(), { top: "permissions: write-all" }),
      }),
    ).toEqual([TOP_BAD]);
  });

  it("refuses write-all on the named job, naming what it asked for", () => {
    expect(
      permissionProblems({
        "nightly.yml": nightlyJob(
          sound({ permissions: "    permissions: write-all" }),
        ),
      }),
    ).toEqual([notExact("write-all")]);
  });

  it("refuses flow-style permissions on the named job, naming the flow text", () => {
    expect(
      permissionProblems({
        "nightly.yml": nightlyJob(
          sound({
            permissions:
              "    permissions: { issues: write, actions: read, contents: read }",
          }),
        ),
      }),
    ).toEqual([notExact("{ issues: write, actions: read, contents: read }")]);
  });
});

describe("permissionProblems refuses look-alike names and extra signing scopes", () => {
  it("refuses an upper-case look-alike of the named job, as an ordinary write in nightly.yml", () => {
    expect(
      permissionProblems({
        "nightly.yml": nightlyJob(sound(), { name: "Failure-Issue" }),
      }),
    ).toEqual([
      "nightly.yml: job Failure-Issue requests issues: write; only release.yaml may write, so drop it",
    ]);
  });

  it("refuses a longer look-alike of the named job, as an ordinary write in nightly.yml", () => {
    expect(
      permissionProblems({
        "nightly.yml": nightlyJob(sound(), { name: "failure-issue-2" }),
      }),
    ).toEqual([
      "nightly.yml: job failure-issue-2 requests issues: write; only release.yaml may write, so drop it",
    ]);
  });

  it("refuses id-token write on the named job", () => {
    expect(
      permissionProblems({
        "nightly.yml": nightlyJob(
          sound({
            permissions:
              "    permissions:\n      issues: write\n      actions: read\n      contents: read\n      id-token: write",
          }),
        ),
      }),
    ).toEqual([
      notExact("issues: write, actions: read, contents: read, id-token: write"),
    ]);
  });

  it("refuses packages write on the named job", () => {
    expect(
      permissionProblems({
        "nightly.yml": nightlyJob(
          sound({
            permissions:
              "    permissions:\n      issues: write\n      actions: read\n      contents: read\n      packages: write",
          }),
        ),
      }),
    ).toEqual([
      notExact("issues: write, actions: read, contents: read, packages: write"),
    ]);
  });

  it("refuses pull-requests write on the named job", () => {
    expect(
      permissionProblems({
        "nightly.yml": nightlyJob(
          sound({
            permissions:
              "    permissions:\n      issues: write\n      actions: read\n      contents: read\n      pull-requests: write",
          }),
        ),
      }),
    ).toEqual([
      notExact(
        "issues: write, actions: read, contents: read, pull-requests: write",
      ),
    ]);
  });
});

describe("permissionProblems refuses a needs that is not exactly integration", () => {
  it("refuses a needs list on the named job; the guard reads needs as one scalar", () => {
    expect(
      permissionProblems({
        "nightly.yml": nightlyJob(sound({ needs: "[integration, live]" })),
      }),
    ).toEqual([
      "nightly.yml: job failure-issue must wait for the integration job; add `needs: integration`",
    ]);
  });

  it("refuses a needs block list on the named job, the same way", () => {
    expect(
      permissionProblems({
        "nightly.yml": nightlyJob(sound({ needs: "\n      - integration" })),
      }),
    ).toEqual([
      "nightly.yml: job failure-issue must wait for the integration job; add `needs: integration`",
    ]);
  });

  it("refuses a needs value other than integration", () => {
    expect(
      permissionProblems({
        "nightly.yml": nightlyJob(sound({ needs: "live" })),
      }),
    ).toEqual([
      "nightly.yml: job failure-issue must wait for the integration job; add `needs: integration`",
    ]);
  });
});
