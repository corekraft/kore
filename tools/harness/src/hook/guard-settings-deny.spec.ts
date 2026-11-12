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

describe("an Edit is judged by the whole file it would leave", () => {
  const compact = JSON.stringify({
    permissions: { allow: ["Bash(ls)"], deny: ["Bash(h:*)", "Bash(a:*)"] },
  });
  const runOn = (disk: string, payload: unknown) =>
    guard(payload, committedInventoryText, "/repo", { [SETTINGS]: disk });
  const warned = (result: { code: number; out: string }) => {
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/guard:guardrail-demotion/);
  };

  it("warns when deny is renamed to ask", async () => {
    warned(await runOn(compact, edit('"deny":', '"ask":')));
  });

  it("warns when a pattern moves from deny into allow", async () => {
    warned(
      await runOn(
        compact,
        edit(
          '"allow":["Bash(ls)"],"deny":["Bash(h:*)",',
          '"allow":["Bash(ls)","Bash(h:*)"],"deny":[',
        ),
      ),
    );
  });

  it("warns when replace_all rewrites every occurrence of a pattern", async () => {
    const both = JSON.stringify({
      permissions: { ask: ["Bash(h:*)"], deny: ["Bash(h:*)"] },
    });
    const payload = edit('"Bash(h:*)"', '"Bash(z:*)"');
    warned(
      await runOn(both, {
        ...payload,
        tool_input: { ...payload.tool_input, replace_all: true },
      }),
    );
  });

  it("warns when the old_string mixes a partial entry with a whole one", async () => {
    const lines = committedInventoryText.split("\n");
    const at = lines.findIndex((l) => l.includes('"deny-helm-uninstall"'));
    const tail = '"deny": ["Bash(helm uninstall:*)"] },';
    const whole = lines[at + 1] ?? "";
    const result = await guard(
      {
        session_id: "s1",
        tool_name: "Edit",
        tool_input: {
          file_path: "/repo/.claude/guardrails.yaml",
          old_string: `${tail}\n${whole}`,
          new_string: `"deny": ["Bash(helm uninstall kore:*)"] },\n${whole}`,
        },
      },
      committedInventoryText,
    );
    warned(result);
    expect(result.out).toMatch(/deny-helm-uninstall/);
  });

  it("allows an Edit whose resulting file keeps every deny pattern", async () => {
    const result = await runOn(
      compact,
      edit('"allow":["Bash(ls)"]', '"allow":["Bash(ls)","Bash(pwd)"]'),
    );
    expect(result).toMatchObject({ code: 0, out: "", err: "" });
  });
});

describe("a command that rewrites settings.json is guarded like the inventory", () => {
  it.each([
    "sed -i 's/deny/ask/' .claude/settings.json",
    "jq '.permissions.deny=[]' .claude/settings.json > .claude/settings.json",
    "cat new.json | tee .claude/settings.json",
    "mv new.json /repo/.claude/settings.json",
  ])("warns on: %s", async (command) => {
    const result = await guard(bash(command), committedInventoryText);
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/guard:guardrail-demotion.*settings\.json/);
  });

  it.each([
    "cat .claude/settings.json",
    "jq .permissions.deny .claude/settings.json",
    "git diff .claude/settings.json",
    "echo x >> .claude/settings.json.bak",
  ])("allows: %s", async (command) => {
    const result = await guard(bash(command), committedInventoryText);
    expect(result).toMatchObject({ code: 0, out: "", err: "" });
  });
});
