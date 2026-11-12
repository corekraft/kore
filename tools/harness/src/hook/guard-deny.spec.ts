import { describe, expect, it } from "vitest";
import { committedInventory } from "../testing/guardrail-support.js";
import { auditEvents, bash, guard } from "./guard-modes-support.js";

// Synthetic deny rules on commands and paths no other guard rule covers, so the
// verdict is the deny rule's alone.
const withMode = (mode: "audit" | "enforce") =>
  JSON.stringify({
    guardrails: [
      ...committedInventory.guardrails,
      {
        rule: "deny-example-command",
        kind: "bash",
        mode,
        owner: ".claude/settings.json",
        deny: ["Bash(example-tool wipe:*)"],
      },
      {
        rule: "deny-example-read",
        kind: "file",
        mode,
        owner: ".claude/settings.json",
        deny: ["Read(./docs/private/**)"],
      },
    ],
  });

describe("a deny rule in audit mode", () => {
  const audit = withMode("audit");

  it("warns and records a ledger event instead of denying the call", async () => {
    const result = await guard(bash("example-tool wipe all"), audit);
    expect(result.code).toBe(0);
    expect(result.err).toBe("");
    expect(JSON.parse(result.out).hookSpecificOutput.additionalContext).toMatch(
      /\[guard:deny-example-command\].*Bash\(example-tool wipe:\*\)/,
    );
    expect(auditEvents(result.events)).toMatchObject([
      { label: "deny-example-command", session: "s1" },
    ]);
  });

  it("matches the pattern in any segment of a compound command", async () => {
    const result = await guard(bash("echo ok && example-tool wipe all"), audit);
    expect(result.out).toMatch(/deny-example-command/);
  });

  it("stays silent for a command the pattern does not match", async () => {
    const result = await guard(bash("example-tool list"), audit);
    expect(result.out).toBe("");
    expect(auditEvents(result.events)).toEqual([]);
  });

  it("warns for a file deny pattern", async () => {
    const result = await guard(
      {
        session_id: "s1",
        tool_name: "Read",
        tool_input: { file_path: "/repo/docs/private/notes.md" },
      },
      withMode("audit"),
      "/repo",
    );
    expect(result.out).toMatch(/deny-example-read/);
  });
});

describe("a deny rule in enforce mode", () => {
  it("leaves denying to Claude Code settings, so the guard adds no warning", async () => {
    const result = await guard(
      bash("example-tool wipe all"),
      withMode("enforce"),
    );
    expect(result.out).not.toMatch(/deny-example-command/);
    expect(auditEvents(result.events)).toEqual([]);
  });
});
