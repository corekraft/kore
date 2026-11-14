// The context hook as the host runs it: SessionStart JSON on stdin, additional
// context on stdout, fail-open for bad input, a visible fault for a broken hook.
// Docs: infra/plans/4-knowledge.md#step-4-upward-context

import { afterEach, describe, expect, it } from "vitest";
import { run } from "../../src/cli/index.js";
import { testHarness } from "../../src/testing/index.js";
import { nodeFileSystem } from "../../src/runtime/index.js";
import * as hookFeedback from "./hook-feedback-support.js";
import * as hookRun from "./hook-run-support.js";

const { additional, agents, cleanTemps, context, repository } = hookRun;
const { repoPlan: plan } = hookRun;
const { ledgerEvents } = hookFeedback;

afterEach(cleanTemps);

describe("harness hook context", () => {
  it("injects context after compaction and stays silent on resume", async () => {
    const root = repository({
      "AGENTS.md": agents,
      "infra/plans/3-agent-harness.md": plan,
    });
    const compacted = await context(
      root,
      JSON.stringify({ hook_event_name: "SessionStart", source: "compact" }),
    );
    expect(compacted.code).toBe(0);
    const output = (
      JSON.parse(compacted.out) as {
        hookSpecificOutput: { hookEventName: string };
      }
    ).hookSpecificOutput;
    expect(output.hookEventName).toBe("SessionStart");
    expect(additional(compacted)).toMatch(/One owner per resource/);

    const resumed = await context(
      root,
      JSON.stringify({ hook_event_name: "SessionStart", source: "resume" }),
    );
    expect(resumed.code).toBe(0);
    expect(resumed.out).toBe("");
  });
});

describe("harness hook context, failing open", () => {
  it("malformed input fails open", async () => {
    const result = await context(repository(), "not json");
    expect(result.code).toBe(0);
    expect(result.out).toBe("");
  });

  it("valid JSON that is not an object fails open", async () => {
    for (const input of ["null", "42", "[]"]) {
      const result = await context(repository(), input);
      expect(result.code, input).toBe(0);
      expect(result.out, input).toBe("");
      expect(result.err, input).toBe("");
    }
  });

  it("with an empty plans directory the rules are still restored", async () => {
    const root = repository({ "AGENTS.md": agents });
    const result = await context(root, JSON.stringify({ source: "compact" }));
    expect(result.code).toBe(0);
    expect(additional(result)).toMatch(/One owner per resource/);
  });

  it("without AGENTS.md the hook fails open and prints nothing", async () => {
    const result = await context(
      repository(),
      JSON.stringify({ source: "compact" }),
    );
    expect(result.code).toBe(0);
    expect(result.out).toBe("");
    expect(result.err).toBe("");
  });

  it("exits 1 and says it failed when the brief breaks, so a broken hook is never silent", async () => {
    const root = repository({ "AGENTS.md": agents });
    const h = testHarness();
    const deps = {
      ...h.deps,
      fs: {
        ...nodeFileSystem,
        readFile: () =>
          Promise.reject(
            Object.assign(new Error("denied"), { code: "EACCES" }),
          ),
      },
      root: () => Promise.resolve(root),
      stdin: () => Promise.resolve(JSON.stringify({ source: "compact" })),
    };
    expect(await run(["hook", "context"], deps)).toBe(1);
    expect(h.err()).toMatch(/\[hook:context\] failed: denied/);
    expect(h.out()).toBe("");
  });
});

describe("harness hook context, and the ledger", () => {
  it("records nothing, so its behaviour never depends on the ledger", async () => {
    const h = testHarness({
      env: { KORE_ROOT: "/repo", CLAUDE_PROJECT_DIR: "/repo" },
      files: { "/repo/AGENTS.md": agents, "/repo/infra/plans/3-p.md": plan },
    });
    h.deps.stdin = () =>
      Promise.resolve(JSON.stringify({ session_id: "s1", source: "startup" }));
    expect(await run(["hook", "context"], h.deps)).toBe(0);
    expect(h.out()).not.toBe("");
    expect(ledgerEvents(h.files)).toEqual([]);
  });
});
