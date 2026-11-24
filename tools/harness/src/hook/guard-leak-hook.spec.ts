import { describe, expect, it } from "vitest";
import { run } from "../cli/index.js";
import { testHarness } from "../testing/index.js";
import { committedInventoryText } from "../testing/index.js";
import { INVENTORY_PATH } from "../guardrail/index.js";

// The hook as the host runs it, with the platform domain in the hook's environment or not. The
// rule warns through additional context, never blocks (audit mode), and never echoes the value.
const DOMAIN = "platform.example.com";

async function guard(payload: unknown, env: Record<string, string> = {}) {
  const h = testHarness({
    env: {
      CLAUDE_PROJECT_DIR: "/repo",
      KORE_ROOT: "/repo",
      HOME: "/home/test",
      ...env,
    },
    files: { [`/repo/${INVENTORY_PATH}`]: committedInventoryText },
  });
  h.deps.stdin = () => Promise.resolve(JSON.stringify(payload));
  const code = await run(["hook", "guard"], h.deps);
  return { code, out: h.out() };
}

const write = (content: string) => ({
  session_id: "s1",
  tool_name: "Write",
  tool_input: { file_path: "/repo/docs/notes.md", content },
});
const edit = (newString: string) => ({
  session_id: "s1",
  tool_name: "Edit",
  tool_input: {
    file_path: "/repo/docs/notes.md",
    old_string: "x",
    new_string: newString,
  },
});
const bash = (command: string) => ({
  session_id: "s1",
  tool_name: "Bash",
  tool_input: { command },
});

const warning = (out: string): string =>
  JSON.parse(out).hookSpecificOutput.additionalContext;

describe("hook guard warns when a write names the platform domain", () => {
  const env = { KORE_PLATFORM_DOMAIN: DOMAIN };

  it("warns on a Write whose content names the domain, and exits 0", async () => {
    const result = await guard(write(`open login.${DOMAIN} first`), env);
    expect(result.code).toBe(0);
    expect(warning(result.out)).toMatch(/^\[guard:platform-domain-leak\] /);
  });

  it("warns on an Edit whose new text names the domain", async () => {
    const result = await guard(edit(`host ${DOMAIN}`), env);
    expect(result.code).toBe(0);
    expect(warning(result.out)).toMatch(/^\[guard:platform-domain-leak\] /);
  });

  it("warns on a commit message that names the domain", async () => {
    const result = await guard(
      bash(`git commit -m "point the proxy at ${DOMAIN}"`),
      env,
    );
    expect(result.code).toBe(0);
    expect(warning(result.out)).toMatch(/^\[guard:platform-domain-leak\] /);
  });

  it("warns on a gh body that names the domain", async () => {
    const result = await guard(
      bash(`gh issue comment 1 --body "see login.${DOMAIN}"`),
      env,
    );
    expect(result.code).toBe(0);
    expect(warning(result.out)).toMatch(/^\[guard:platform-domain-leak\] /);
  });

  it("names the fix and never echoes the domain", async () => {
    const result = await guard(write(`host ${DOMAIN}`), env);
    expect(warning(result.out)).toContain("write example.com");
    expect(result.out).not.toContain(DOMAIN);
  });
});

describe("hook guard is silent about the platform domain when it is not set", () => {
  it("does not warn when no domain is set, whatever the text", async () => {
    const result = await guard(write(`host ${DOMAIN}`));
    expect(result.code).toBe(0);
    expect(result.out).toBe("");
  });

  it("does not warn when the domain is the repository's own placeholder", async () => {
    const result = await guard(write("host kore.internal"), {
      KORE_PLATFORM_DOMAIN: "kore.internal",
    });
    expect(result.out).toBe("");
  });

  it("does not warn on text that does not name the domain", async () => {
    const result = await guard(write("write example.com instead"), {
      KORE_PLATFORM_DOMAIN: DOMAIN,
    });
    expect(result.out).toBe("");
  });
});
