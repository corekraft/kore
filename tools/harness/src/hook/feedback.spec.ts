// Feedback hook, post-edit mode: the contract of the former
// .claude/hooks/feedback.mjs, kept byte for byte. Plan: infra/plans/3-agent-harness.md (Step 3).

import { describe, expect, it } from "vitest";
import { run } from "../cli/index.js";
import { testHarness } from "../cli/cli-support.js";
import {
  HARNESS_BIN,
  KORE_BIN,
  edited,
  failing,
  hook,
  lines,
  marked,
  root,
} from "./feedback-support.js";
import { bound, isHarnessSource, isTrackedSource } from "./feedback.js";

describe("source matching", () => {
  it("tracks only TypeScript under tools/kore/src", () => {
    expect(isTrackedSource("tools/kore/src/cli/cli.ts", root)).toBe(true);
    expect(isTrackedSource("/repo/tools/kore/src/a/b.ts", root)).toBe(true);
    expect(isTrackedSource("tools/kore/src/a.spec.ts", root)).toBe(true);
    expect(isTrackedSource("tools/kore/package.json", root)).toBe(false);
    expect(isTrackedSource("README.md", root)).toBe(false);
  });

  it("tracks only TypeScript under tools/harness/src or tests", () => {
    expect(isHarnessSource("tools/harness/src/cli/cli.ts", root)).toBe(true);
    expect(isHarnessSource("/repo/tools/harness/tests/a.spec.ts", root)).toBe(
      true,
    );
    expect(isHarnessSource("tools/harness/package.json", root)).toBe(false);
    expect(isHarnessSource("tools/kore/src/a.ts", root)).toBe(false);
    expect(isHarnessSource("skills/bin/harness.mjs", root)).toBe(false);
  });
});

describe("bound", () => {
  it("leaves short output untouched", () => {
    expect(bound(lines(40), "cmd")).toBe(lines(40));
  });

  it("keeps the first 40 lines and says how to see the rest", () => {
    const result = bound(lines(100), "npm run check");
    expect(result).toMatch(/line 40\n/);
    expect(result).not.toMatch(/line 41/);
    expect(result).toMatch(/60 more lines cut/);
    expect(result).toMatch(/npm run check/);
  });
});

describe("hook feedback post-edit", () => {
  it("runs nothing for files outside the tracked sources", async () => {
    const result = await hook("post-edit", edited("/repo/README.md"));
    expect(result.code).toBe(0);
    expect(result.err).toBe("");
    expect(result.calls).toEqual([]);
    expect(marked(result.files, "ts")).toBe(false);
  });

  it("stays quiet when lint and formatting pass, and records the change", async () => {
    const result = await hook("post-edit", edited("/repo/tools/kore/src/a.ts"));
    expect(result.code).toBe(0);
    expect(result.err).toBe("");
    expect(result.calls.map(([c]) => c)).toEqual([
      `${KORE_BIN}/oxlint`,
      `${KORE_BIN}/prettier`,
    ]);
    expect(marked(result.files, "ts")).toBe(true);
    expect(marked(result.files, "harness")).toBe(false);
  });

  it("reports a lint violation in the same turn with exit 2", async () => {
    const result = await hook(
      "post-edit",
      edited("/repo/tools/kore/src/a.ts"),
      {
        responses: [failing(`${KORE_BIN}/oxlint`, "no-unused-vars")],
      },
    );
    expect(result.code).toBe(2);
    expect(result.err).toBe(
      "oxlint reported problems in /repo/tools/kore/src/a.ts. Fix them before continuing.\nno-unused-vars\n",
    );
    expect(result.out).toBe("");
  });

  it("reports a formatting violation with the fix", async () => {
    const result = await hook(
      "post-edit",
      edited("/repo/tools/kore/src/a.ts"),
      {
        responses: [failing(`${KORE_BIN}/prettier`, "needs format")],
      },
    );
    expect(result.code).toBe(2);
    expect(result.err).toBe(
      "/repo/tools/kore/src/a.ts is not formatted. Run `tools/kore/node_modules/.bin/prettier --write /repo/tools/kore/src/a.ts`.\nneeds format\n",
    );
  });
});

describe("hook feedback post-edit bounds reports", () => {
  it("bounds a large lint report", async () => {
    const result = await hook(
      "post-edit",
      edited("/repo/tools/kore/src/a.ts"),
      {
        responses: [failing(`${KORE_BIN}/oxlint`, lines(500))],
      },
    );
    expect(result.code).toBe(2);
    expect(result.err).toBe(
      `oxlint reported problems in /repo/tools/kore/src/a.ts. Fix them before continuing.\n${lines(40)}\n... 460 more lines cut. Run \`tools/kore/node_modules/.bin/oxlint --deny-warnings /repo/tools/kore/src/a.ts\` to see all.\n`,
    );
  });

  it("bounds a large format report", async () => {
    const result = await hook(
      "post-edit",
      edited("/repo/tools/kore/src/a.ts"),
      {
        responses: [failing(`${KORE_BIN}/prettier`, lines(500))],
      },
    );
    expect(result.code).toBe(2);
    expect(result.err).toBe(
      `/repo/tools/kore/src/a.ts is not formatted. Run \`tools/kore/node_modules/.bin/prettier --write /repo/tools/kore/src/a.ts\`.\n${lines(40)}\n... 460 more lines cut. Run \`tools/kore/node_modules/.bin/prettier --check /repo/tools/kore/src/a.ts\` to see all.\n`,
    );
  });
});

describe("hook feedback post-edit on harness sources and other tools", () => {
  it("lints and format-checks harness sources with the harness tools", async () => {
    const result = await hook(
      "post-edit",
      edited("/repo/tools/harness/src/a.ts", "Write"),
    );
    expect(result.code).toBe(0);
    expect(result.calls.map(([c]) => c)).toEqual([
      `${HARNESS_BIN}/oxlint`,
      `${HARNESS_BIN}/prettier`,
    ]);
    expect(marked(result.files, "harness")).toBe(true);
    expect(marked(result.files, "ts")).toBe(false);
  });

  it("reports a harness lint violation", async () => {
    const result = await hook(
      "post-edit",
      edited("/repo/tools/harness/src/a.ts"),
      {
        responses: [failing(`${HARNESS_BIN}/oxlint`, "no-shadow")],
      },
    );
    expect(result.code).toBe(2);
    expect(result.err).toBe(
      "oxlint reported problems in /repo/tools/harness/src/a.ts. Fix them before continuing.\nno-shadow\n",
    );
  });

  it("reports a harness formatting violation with the pinned fix", async () => {
    const result = await hook(
      "post-edit",
      edited("/repo/tools/harness/src/a.ts"),
      {
        responses: [failing(`${HARNESS_BIN}/prettier`, "needs format")],
      },
    );
    expect(result.code).toBe(2);
    expect(result.err).toBe(
      "/repo/tools/harness/src/a.ts is not formatted. Run `mise run format /repo/tools/harness/src/a.ts`.\nneeds format\n",
    );
  });
});

describe("hook feedback post-edit ignores", () => {
  it("ignores the read tool on a tracked file", async () => {
    const result = await hook(
      "post-edit",
      edited("/repo/tools/kore/src/a.ts", "Read"),
    );
    expect(result.code).toBe(0);
    expect(result.err).toBe("");
    expect(result.calls).toEqual([]);
  });

  it("checks a call that names no tool", async () => {
    const result = await hook("post-edit", {
      tool_input: { file_path: "/repo/tools/kore/src/a.ts" },
    });
    expect(result.calls).toHaveLength(2);
  });

  it("ignores a call whose input has no file path", async () => {
    const result = await hook("post-edit", { tool_name: "Edit" });
    expect(result.code).toBe(0);
    expect(result.calls).toEqual([]);
  });

  it("falls back to the payload cwd, then the working directory, for the root", async () => {
    const h = testHarness();
    h.deps.stdin = () =>
      Promise.resolve(
        JSON.stringify({
          ...edited("/work/tools/kore/src/a.ts"),
          cwd: "/work",
        }),
      );
    await run(["hook", "feedback", "post-edit"], h.deps);
    expect(h.runner.calls.find((c) => c.command !== "git")?.command).toBe(
      "/work/tools/kore/node_modules/.bin/oxlint",
    );
    const bare = testHarness();
    bare.deps.stdin = () =>
      Promise.resolve(JSON.stringify(edited("/work/tree/tools/kore/src/a.ts")));
    await run(["hook", "feedback", "post-edit"], bare.deps);
    expect(bare.runner.calls.find((c) => c.command !== "git")?.command).toBe(
      "/work/tree/tools/kore/node_modules/.bin/oxlint",
    );
  });
});
