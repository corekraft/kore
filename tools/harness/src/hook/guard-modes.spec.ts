import { describe, expect, it } from "vitest";
import { committedInventoryText } from "../testing/index.js";
import { auditEvents, bash, guard, modes } from "./guard-modes-support.js";

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
      bash("k3d cluster delete kore-local"),
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
      bash("k3d cluster delete kore-local; git commit --no-verify -m x"),
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
    const result = await guard(
      bash("k3d cluster delete kore-local"),
      committedInventoryText,
    );
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

describe("a promoted rule beats an audit warning in the same call", () => {
  it("blocks equals-word at enforce beside a bare glob", async () => {
    const result = await guard(
      bash("ls *.nothing =foo"),
      modes({ "equals-word": "enforce" }),
    );
    expect(result.code).toBe(2);
    expect(result.err).toMatch(/guard:equals-word/);
    expect(auditEvents(result.events)).toEqual([]);
  });

  it("blocks bare-glob at enforce beside an equals-word", async () => {
    const result = await guard(
      bash("echo =foo *.nothing"),
      modes({ "bare-glob": "enforce" }),
    );
    expect(result.code).toBe(2);
    expect(result.err).toMatch(/guard:bare-glob/);
  });

  it("blocks a promoted zsh rule beside a segment rule in audit", async () => {
    const result = await guard(
      bash("gh issue edit 1 --body x; echo =foo"),
      modes({ "equals-word": "enforce" }),
    );
    expect(result.code).toBe(2);
    expect(result.err).toMatch(/guard:equals-word/);
  });

  it("joins every warning and records one audit event per rule when no rule blocks", async () => {
    const result = await guard(
      bash("ls *.nothing; gh issue edit 1 --body x"),
      committedInventoryText,
    );
    expect(result.code).toBe(0);
    const context = JSON.parse(result.out).hookSpecificOutput.additionalContext;
    expect(context).toMatch(/guard:idea-issue-body/);
    expect(context).toMatch(/guard:bare-glob/);
    expect(
      auditEvents(result.events)
        .map((e) => String(e["label"]))
        .sort((a, b) => a.localeCompare(b)),
    ).toEqual(["bare-glob", "idea-issue-body"]);
  });

  it("records the rule once when two segments trip it", async () => {
    const result = await guard(
      bash("gh issue edit 1 --body x; gh issue edit 2 --body y"),
      committedInventoryText,
    );
    expect(auditEvents(result.events)).toHaveLength(1);
  });

  it("blocks equals-word as declared, with no audit event", async () => {
    const result = await guard(bash("echo =foo"), committedInventoryText);
    expect(result.code).toBe(2);
    expect(result.err).toMatch(/^\[guard:equals-word\] .*Instead/);
    expect(auditEvents(result.events)).toEqual([]);
  });

  it("lets a promoted rule block past an earlier audit rule in the same segment", async () => {
    const result = await guard(
      bash("gh issue edit 1 --body x > .kore/state/ledger.jsonl"),
      modes({ "append-only": "enforce" }),
    );
    expect(result.code).toBe(2);
    expect(result.err).toMatch(/guard:append-only/);
    expect(auditEvents(result.events)).toEqual([]);
  });
});

describe("a promoted file rule beats an audit warning on the same write", () => {
  const write = {
    session_id: "s1",
    tool_name: "Write",
    tool_input: {
      file_path: "/repo/apps/web/d.yaml",
      content: "image: web:1\n",
    },
  };
  it("blocks image-digest at enforce while another rule only warns", async () => {
    const result = await guard(write, modes({ "image-digest": "enforce" }));
    expect(result.code).toBe(2);
    expect(result.err).toMatch(/guard:image-digest/);
    expect(auditEvents(result.events)).toEqual([]);
  });

  it("blocks image-digest promoted beside an audit flag-activation", async () => {
    const result = await guard(
      {
        session_id: "s1",
        tool_name: "Write",
        tool_input: {
          file_path: "/repo/infra/environments/local/environment.yaml",
          content: '"features": { "a-b": true }\nimage: web:1\n',
        },
      },
      modes({ "image-digest": "enforce" }),
    );
    expect(result.code).toBe(2);
    expect(result.err).toMatch(/guard:image-digest/);
  });
});
