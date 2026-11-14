import { describe, expect, it } from "vitest";
import { precheck } from "../../src/judge/index.js";
import type { CommandContext } from "../../src/runtime/index.js";
import {
  FakeRunner,
  type FakeResponse,
  harness,
} from "../../src/testing/index.js";

// The judge's diff reading, hints and verdict run together here, through the
// precheck, with gh replaced by a fake that returns the PR and its diff text.
// These cases moved from the unit specs of the diff, hints and verdict units,
// which cannot run the real diff reader beside the units they check (ADR 0098).

const BASE = "base0000";
const HEAD = "abc1234def5678abc1234def5678abc1234def56";
const COMMITTED = "2026-11-14T10:00:00Z";

const fileDiff = (path: string, body = "+x") =>
  `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n${body}`;

const deletion = (path: string) =>
  [
    `diff --git a/${path} b/${path}`,
    "deleted file mode 100644",
    `--- a/${path}`,
    "+++ /dev/null",
    "@@ -1 +0,0 @@",
    "-x",
  ].join("\n");

const overlay = (env: string, hunk: string[]) =>
  [
    `diff --git a/infra/environments/${env}/environment.yaml b/infra/environments/${env}/environment.yaml`,
    `--- a/infra/environments/${env}/environment.yaml`,
    `+++ b/infra/environments/${env}/environment.yaml`,
    "@@ -1,3 +1,3 @@",
    ...hunk,
  ].join("\n");

const flagged = (env: string, value: boolean) =>
  overlay(env, ['   "features": {', `+    "gateway": ${value},`, "   }"]);

const EXPAND_PR = 547;
const IDEA = 99;

/** The precheck of a PR with this declared pattern and this diff text; `lines` follow the pattern line in its body. */
function check(
  pattern: string,
  diff: string,
  lines: readonly string[] = [],
  extra: readonly FakeResponse[] = [],
) {
  const runner = new FakeRunner([
    ...extra,
    {
      match: (_command, args) => args[1] === "view" && args[2] === "42",
      result: {
        stdout: JSON.stringify({
          body: [`Safety pattern: ${pattern}`, ...lines].join("\n"),
          baseRefOid: BASE,
          headRefOid: HEAD,
          commits: [{ committedDate: COMMITTED }],
        }),
      },
    },
    {
      match: (_command, args) => args[1] === "diff",
      result: { stdout: diff },
    },
  ]);
  const context: CommandContext = {
    json: false,
    options: {},
    deps: { ...harness().deps, runner },
  };
  return precheck(context, "/repo", "corekraft/kore", 42, ["reviewer-bot"]);
}

describe("judge precheck: a diff that contradicts the declared pattern", () => {
  it("no-behaviour-change with a behavioural path is a mismatch naming the path", async () => {
    const report = await check(
      "no-behaviour-change",
      fileDiff("tools/kore/src/a.ts"),
    );
    expect(report).toMatchObject({
      patternMatches: false,
      patternMismatch:
        "no-behaviour-change, but the diff changes behaviour in: tools/kore/src/a.ts",
    });
  });

  it("feature-flagged is a mismatch unless a flag is added and off", async () => {
    expect(
      await check("feature-flagged", fileDiff("tools/kore/src/a.ts")),
    ).toMatchObject({ patternMatches: false });
    expect(
      await check("feature-flagged", flagged("local", true)),
    ).toMatchObject({ patternMatches: false });
    expect(
      await check("feature-flagged", flagged("local", false)),
    ).toMatchObject({ patternMatches: true });
  });

  it("dark-launched is a mismatch unless the flag is on only in local", async () => {
    expect(
      (await check("dark-launched", flagged("prod", true))).patternMatches,
    ).toBe(false);
    expect(
      (await check("dark-launched", flagged("local", true))).patternMatches,
    ).toBe(true);
  });

  it("branch-by-abstraction is a mismatch when the diff deletes a file", async () => {
    expect(
      (await check("branch-by-abstraction", deletion("old.ts"))).patternMatches,
    ).toBe(false);
  });

  it("expand-contract is a mismatch when the diff removes without replacing", async () => {
    expect(
      await check("expand-contract", fileDiff("a.ts", "-old\n-older")),
    ).toMatchObject({
      patternMatches: false,
      patternMismatch:
        "expand-contract, but the diff removes 2 line(s) without replacing them and deletes 0 file(s); that is a contract step: name its merged expand PR on an `Expand step: #<n>` line, and record `Expand proof: #<n>` on the idea issue",
    });
  });

  it("expand-contract matches an additive diff and ignores the generated bundle", async () => {
    const diff = [
      fileDiff("a.ts", "+new"),
      fileDiff("skills/bin/harness.mjs", "-a\n-b\n-c"),
    ].join("\n");
    expect((await check("expand-contract", diff)).patternMatches).toBe(true);
  });
});

describe("judge precheck: a contract whose expand step is proven", () => {
  it("expand-contract with a proven expand step matches a removing diff", async () => {
    const report = await check(
      "expand-contract",
      fileDiff("a.ts", "-old\n-older"),
      [`Idea: #${IDEA}`, `Expand step: #${EXPAND_PR}`],
      [
        {
          match: (_command, args) =>
            args[0] === "pr" && args[2] === String(EXPAND_PR),
          result: {
            stdout: JSON.stringify({ mergedAt: "2026-11-13T09:00:00Z" }),
          },
        },
        {
          match: (_command, args) =>
            args[0] === "issue" && args[2] === String(IDEA),
          result: {
            stdout: JSON.stringify({
              comments: [
                {
                  body: `Expand proof: #${EXPAND_PR}`,
                  author: { login: "reviewer-bot" },
                  createdAt: "2026-11-14T09:00:00Z",
                },
              ],
            }),
          },
        },
      ],
    );
    expect(report).toMatchObject({
      patternMatches: true,
      checks: { expandStep: { result: "pass" } },
    });
    expect(report).not.toHaveProperty("patternMismatch");
  });
});

describe("judge precheck reads the overlay's features object", () => {
  // The line copied from infra/environments/local/environment.yaml.
  const REAL_LINE = '  "features": { "ingress-agentgateway": false },';

  it("reads the real inline overlay format", async () => {
    const diff = overlay("local", [
      '   "registry": { "address": "10.96.0.50:5000" },',
      `+${REAL_LINE}`,
      '   "imageInventory": "audit",',
    ]);
    expect((await check("feature-flagged", diff)).hints).toEqual({
      flags: [
        { flag: "ingress-agentgateway", environment: "local", value: false },
      ],
      flagPresentAndOff: true,
    });
  });

  it("reads a flag added on the opening line of a multiline features object", async () => {
    const diff = overlay("local", [
      '+  "features": { "a": false,',
      '     "b": true',
      "   },",
    ]);
    expect((await check("feature-flagged", diff)).hints).toMatchObject({
      flags: [{ flag: "a", environment: "local", value: false }],
    });
  });

  it("ignores a features line that is unchanged context", async () => {
    const diff = overlay("local", [
      '   "features": { "a": false },',
      '+  "other": 1,',
    ]);
    expect((await check("feature-flagged", diff)).hints).toMatchObject({
      flags: [],
    });
  });

  it("reads a flag changed from on to off as the new value", async () => {
    const diff = overlay("local", [
      '-  "features": { "a": true },',
      '+  "features": { "a": false },',
    ]);
    expect((await check("feature-flagged", diff)).hints).toMatchObject({
      flagPresentAndOff: true,
    });
  });
});
