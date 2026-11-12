import { describe, expect, it } from "vitest";
import {
  committedInventoryText,
  inventoryWith,
} from "../testing/guardrail-support.js";
import { auditEvents, bash, guard, modes } from "./guard-modes-support.js";

describe("the inventory protects itself", () => {
  const edit = (oldS: string, newS: string) => ({
    session_id: "s1",
    tool_name: "Edit",
    tool_input: {
      file_path: "/repo/.claude/guardrails.yaml",
      old_string: oldS,
      new_string: newS,
    },
  });
  const line = (rule: string, mode: string) =>
    `{ "rule": "${rule}", "kind": "bash", "mode": "${mode}", "owner": "x" }`;

  it("warns, naming the rule, on an Edit that turns enforce into audit", async () => {
    const result = await guard(
      edit(line("no-verify", "enforce"), line("no-verify", "audit")),
      committedInventoryText,
    );
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/guard:guardrail-demotion/);
    expect(result.out).toMatch(/no-verify/);
    expect(auditEvents(result.events)).toMatchObject([
      { label: "guardrail-demotion" },
    ]);
  });

  it("warns on an Edit of the mode alone", async () => {
    const result = await guard(
      edit('"mode": "enforce"', '"mode": "audit"'),
      committedInventoryText,
    );
    expect(result.out).toMatch(/guard:guardrail-demotion/);
  });

  it("warns on a Write that demotes a rule the file enforces today", async () => {
    const result = await guard(
      {
        session_id: "s1",
        tool_name: "Write",
        tool_input: {
          file_path: "/repo/.claude/guardrails.yaml",
          content: inventoryWith({ destructive: "audit" }),
        },
      },
      committedInventoryText,
    );
    expect(result.out).toMatch(/guard:guardrail-demotion/);
    expect(result.out).toMatch(/destructive/);
  });

  it("allows promoting, and edits that leave modes alone", async () => {
    for (const payload of [
      edit(line("bare-glob", "audit"), line("bare-glob", "enforce")),
      edit(
        line("bare-glob", "audit"),
        line("bare-glob", "audit").replace('"x"', '"y"'),
      ),
    ]) {
      const result = await guard(payload, committedInventoryText);
      expect(result).toMatchObject({ code: 0, out: "", err: "" });
      expect(auditEvents(result.events)).toEqual([]);
    }
  });

  it("blocks the demotion once a person promotes the rule", async () => {
    const result = await guard(
      edit(line("no-verify", "enforce"), line("no-verify", "audit")),
      modes({ "guardrail-demotion": "enforce" }),
    );
    expect(result.code).toBe(2);
  });
});

describe("finding the inventory", () => {
  it("walks up from the project directory to the repository's inventory", async () => {
    const result = await guard(
      bash("ls *.nothing"),
      modes({ "bare-glob": "enforce" }),
      "/repo/tools/harness",
    );
    expect(result.code).toBe(2);
    expect(result.err).not.toMatch(/Every rule is enforcing/);
  });
});

describe("the inventory is guarded against Bash edits too", () => {
  it.each([
    "sed -i 's/enforce/audit/' .claude/guardrails.yaml",
    "echo '{}' > .claude/guardrails.yaml",
    "cat new.json | tee .claude/guardrails.yaml",
    "cp new.json /repo/.claude/guardrails.yaml",
    "mv new.json .claude/guardrails.yaml",
  ])("warns in audit mode on: %s", async (command) => {
    const result = await guard(bash(command), committedInventoryText);
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/guard:guardrail-demotion/);
    expect(auditEvents(result.events)).toMatchObject([
      { label: "guardrail-demotion" },
    ]);
  });

  it.each([
    "cat .claude/guardrails.yaml",
    "sed -n 1,5p .claude/guardrails.yaml",
    "git diff .claude/guardrails.yaml",
    "harness guardrail status --json",
    "echo x >> .claude/guardrails.yaml.bak",
  ])("allows: %s", async (command) => {
    const result = await guard(bash(command), committedInventoryText);
    expect(result).toMatchObject({ code: 0, out: "", err: "" });
  });
});
