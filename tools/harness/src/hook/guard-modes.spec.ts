import { describe, expect, it } from "vitest";
import { run } from "../cli/index.js";
import { testHarness } from "../cli/cli-support.js";
import { INVENTORY_PATH, type Mode } from "../guardrail/index.js";
import {
  committedInventoryText,
  inventoryWith,
} from "../testing/guardrail-support.js";
import { ledgerEvents } from "./feedback-support.js";

async function guard(payload: unknown, inventory: string | undefined) {
  const h = testHarness({
    env: { CLAUDE_PROJECT_DIR: "/repo", KORE_ROOT: "/repo" },
    files: {
      ...(inventory === undefined
        ? {}
        : { [`/repo/${INVENTORY_PATH}`]: inventory }),
      "/repo/tools/kore/vitest.config.ts": "thresholds: { statements: 95 }",
    },
  });
  h.deps.stdin = () => Promise.resolve(JSON.stringify(payload));
  const code = await run(["hook", "guard"], h.deps);
  return { code, out: h.out(), err: h.err(), events: ledgerEvents(h.files) };
}

const bash = (command: string) => ({
  session_id: "s1",
  tool_name: "Bash",
  tool_input: { command },
});
const auditEvents = (events: Record<string, unknown>[]) =>
  events.filter((e) => e["kind"] === "guard.audit");
const modes = (m: Record<string, Mode>) => inventoryWith(m);

describe("a guardrail in audit mode", () => {
  it("warns and records a ledger event naming the rule and session, and never blocks", async () => {
    const result = await guard(
      bash("ls *.nothing"),
      modes({ "bare-glob": "audit" }),
    );
    expect(result.code).toBe(0);
    expect(result.err).toBe("");
    expect(JSON.parse(result.out).hookSpecificOutput.additionalContext).toMatch(
      /\[guard:bare-glob\]/,
    );
    expect(auditEvents(result.events)).toMatchObject([
      { source: "claude", session: "s1", label: "bare-glob" },
    ]);
    expect(result.events.map((e) => e["outcome"])).not.toContain("failure");
  });

  it("turns a rule that blocks today into a warning, with its event, when set to audit", async () => {
    const result = await guard(
      bash("minikube delete"),
      modes({ destructive: "audit" }),
    );
    expect(result.code).toBe(0);
    expect(result.err).toBe("");
    expect(result.out).toMatch(/guard:destructive/);
    expect(auditEvents(result.events)).toMatchObject([
      { label: "destructive" },
    ]);
  });

  it("lets a block in a later segment win over a demoted one", async () => {
    const result = await guard(
      bash("minikube delete; git commit --no-verify -m x"),
      modes({ destructive: "audit" }),
    );
    expect(result.code).toBe(2);
    expect(result.err).toMatch(/guard:no-verify/);
  });

  it("warns for a file rule too", async () => {
    const result = await guard(
      {
        session_id: "s1",
        tool_name: "Write",
        tool_input: {
          file_path: "/repo/tools/kore/vitest.config.ts",
          content: "thresholds: { statements: 1 }",
        },
      },
      modes({ "coverage-threshold": "audit" }),
    );
    expect(result.code).toBe(0);
    expect(auditEvents(result.events)).toMatchObject([
      { label: "coverage-threshold" },
    ]);
  });
});

describe("a guardrail in enforce mode", () => {
  it("blocks a rule that warns today and records no audit event", async () => {
    const result = await guard(
      bash("ls *.nothing"),
      modes({ "bare-glob": "enforce" }),
    );
    expect(result.code).toBe(2);
    expect(result.err).toMatch(/^\[guard:bare-glob\] .*Instead/);
    expect(result.out).toBe("");
    expect(auditEvents(result.events)).toEqual([]);
  });

  it("blocks equals-word with a one-line mode change", async () => {
    const result = await guard(
      bash("echo =foo"),
      modes({ "equals-word": "enforce" }),
    );
    expect(result.code).toBe(2);
    expect(auditEvents(result.events)).toEqual([]);
  });

  it("records no audit event when a rule blocks as declared", async () => {
    const result = await guard(bash("minikube delete"), committedInventoryText);
    expect(result.code).toBe(2);
    expect(auditEvents(result.events)).toEqual([]);
  });
});

describe("an inventory the guard cannot use", () => {
  it.each([
    ["missing", undefined, /\.claude\/guardrails\.yaml/],
    ["malformed", "{ nope", /JSON-compatible/],
  ])(
    "enforces every rule when it is %s, and says how to fix it",
    async (_, text, message) => {
      const result = await guard(bash("ls *.nothing"), text);
      expect(result.code).toBe(2);
      expect(result.err).toMatch(/\[guard:bare-glob\]/);
      expect(result.err).toMatch(message);
      expect(auditEvents(result.events)).toEqual([]);
    },
  );
});
