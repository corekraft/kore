import { describe, expect, it } from "vitest";
import { committedInventoryText } from "../testing/guardrail-support.js";
import { auditEvents, bash, guard } from "./guard-modes-support.js";

const SETTINGS = "/repo/.claude/settings.json";
const settings = (allow: string[], deny: string[]) =>
  JSON.stringify({ permissions: { allow, deny } }, null, 2);
const edit = (oldS: string, newS: string) => ({
  session_id: "s1",
  tool_name: "Edit",
  tool_input: { file_path: SETTINGS, old_string: oldS, new_string: newS },
});
const write = (content: string) => ({
  session_id: "s1",
  tool_name: "Write",
  tool_input: { file_path: SETTINGS, content },
});
const onDisk = settings(["Bash(ls)"], ["Bash(helm uninstall:*)", "Bash(a:*)"]);
const run = (payload: unknown) =>
  guard(payload, committedInventoryText, "/repo", { [SETTINGS]: onDisk });

describe("settings.json deny patterns are guarded against removal", () => {
  it.each([
    ["removing a pattern", edit('"Bash(helm uninstall:*)",', "")],
    [
      "narrowing a pattern",
      edit('"Bash(helm uninstall:*)"', '"Bash(helm uninstall kore:*)"'),
    ],
    [
      "a Write that drops a deny pattern",
      write(settings(["Bash(ls)"], ["Bash(a:*)"])),
    ],
  ])("warns, naming the pattern, on %s", async (_, payload) => {
    const result = await run(payload);
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/guard:guardrail-demotion/);
    expect(result.out).toMatch(/helm uninstall/);
    expect(auditEvents(result.events)).toMatchObject([
      { label: "guardrail-demotion" },
    ]);
  });

  it.each([
    ["adding a deny pattern", edit('"Bash(a:*)"', '"Bash(a:*)", "Bash(b:*)"')],
    ["removing an allow pattern", edit('"Bash(ls)"', '"Bash(pwd)"')],
    [
      "a Write that keeps every deny pattern",
      write(settings([], ["Bash(helm uninstall:*)", "Bash(a:*)", "Bash(c:*)"])),
    ],
  ])("allows %s", async (_, payload) => {
    const result = await run(payload);
    expect(result).toMatchObject({ code: 0, out: "", err: "" });
  });
});

describe("guardrail deny --write --allow-removal is guarded", () => {
  it.each([
    "node skills/bin/harness.mjs guardrail deny --write --allow-removal",
    "harness guardrail deny --allow-removal --write",
  ])("warns on: %s", async (command) => {
    const result = await guard(bash(command), committedInventoryText);
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/guard:guardrail-demotion.*--allow-removal/);
    expect(auditEvents(result.events)).toMatchObject([
      { label: "guardrail-demotion" },
    ]);
  });

  it.each([
    "node skills/bin/harness.mjs guardrail deny --write",
    "node skills/bin/harness.mjs guardrail deny --check",
    "node skills/bin/harness.mjs guardrail status --allow-removal",
  ])("allows: %s", async (command) => {
    const result = await guard(bash(command), committedInventoryText);
    expect(result).toMatchObject({ code: 0, out: "", err: "" });
  });
});
