import { describe, expect, it } from "vitest";
import { run } from "../cli/index.js";
import { testHarness } from "../testing/index.js";
import { INVENTORY_PATH } from "../guardrail/index.js";
import { committedInventoryText } from "../testing/index.js";

// The hook as the host runs it: the bare-glob rule resolves from the call's
// directory, through the injected filesystem, and only warns.
async function guard(payload: unknown, seeded: string[]) {
  const h = testHarness({
    env: {
      CLAUDE_PROJECT_DIR: "/repo",
      KORE_ROOT: "/repo",
      HOME: "/home/test",
    },
    files: { [`/repo/${INVENTORY_PATH}`]: committedInventoryText },
  });
  for (const path of seeded) {
    h.files.set(path, "x");
  }
  h.deps.stdin = () => Promise.resolve(JSON.stringify(payload));
  const code = await run(["hook", "guard"], h.deps);
  return { code, out: h.out() };
}

const bare = (cwd?: string) => ({
  session_id: "s1",
  ...(cwd === undefined ? {} : { cwd }),
  tool_name: "Bash",
  tool_input: { command: "ls infra/*.yaml" },
});

describe("hook guard bare glob resolves from the call's directory", () => {
  it("warns when the glob matches under the project root but not under the call's directory", async () => {
    const result = await guard(bare("/repo/wt"), ["/repo/infra/a.yaml"]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out).hookSpecificOutput.additionalContext).toMatch(
      /^\[guard:bare-glob\] infra\/\*\.yaml is an unquoted glob/,
    );
  });

  it("is silent when the glob matches under the call's directory", async () => {
    const result = await guard(bare("/repo/wt"), ["/repo/wt/infra/a.yaml"]);
    expect(result.out).toBe("");
  });

  it("is silent when a cd in the command moves the glob to where it matches", async () => {
    const result = await guard(
      { ...bare("/repo"), tool_input: { command: "cd wt && ls infra/*.yaml" } },
      ["/repo/wt/infra/a.yaml"],
    );
    expect(result.out).toBe("");
  });

  it("resolves from the project root when the payload carries no directory", async () => {
    const result = await guard(bare(), ["/repo/infra/a.yaml"]);
    expect(result.out).toBe("");
  });
});

const on = (command: string) => ({
  session_id: "s1",
  tool_name: "Bash",
  tool_input: { command },
});

describe("hook guard bare glob skips glob characters in pattern arguments", () => {
  it("is silent for a glob character in the pattern of grep, which is not a path", async () => {
    const result = await guard(on("grep -rn Closed* src"), []);
    expect(result.out).toBe("");
  });

  it("warns about the path argument of grep that matches nothing, and not its pattern", async () => {
    const result = await guard(on("grep Closed* docs/*.zzz"), []);
    expect(JSON.parse(result.out).hookSpecificOutput.additionalContext).toMatch(
      /^\[guard:bare-glob\] docs\/\*\.zzz is an unquoted glob/,
    );
  });

  it("is silent for a glob character in a [[ ]] comparison pattern", async () => {
    const result = await guard(on("[[ $x == Closed* ]] && echo ok"), []);
    expect(result.out).toBe("");
  });

  it("is silent for a * operand in arithmetic, which is not a glob", async () => {
    const result = await guard(on("echo $(( * $n * ))"), []);
    expect(result.out).toBe("");
  });
});

describe("hook guard bare glob leaves a glob after a shell variable unjudged", () => {
  it("is silent for a glob whose directory is a shell variable, which the hook cannot resolve", async () => {
    const result = await guard(on('ls "$d/rust/"*.log'), []);
    expect(result.out).toBe("");
  });
});

describe("hook guard bare glob keeps quoted prose quoted", () => {
  it("is silent for a glob inside an ANSI-C quoted --body, past an escaped apostrophe", async () => {
    const result = await guard(
      on("gh pr comment 485 --body $'it\\'s .kore/state/test-slot-*.lock'"),
      [],
    );
    expect(result.out).not.toContain("bare-glob");
  });

  it("warns about a glob outside any quotes after that ANSI-C argument", async () => {
    const result = await guard(
      on("gh pr comment 485 --body $'done' .kore/state/test-slot-*.lock"),
      [],
    );
    expect(
      JSON.parse(result.out).hookSpecificOutput.additionalContext,
    ).toContain(
      "[guard:bare-glob] .kore/state/test-slot-*.lock is an unquoted glob",
    );
  });
});
