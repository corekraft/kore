import { describe, expect, it } from "vitest";
import { run } from "../cli/index.js";
import { testHarness } from "../cli/cli-support.js";
import { INVENTORY_PATH } from "../guardrail/index.js";
import { committedInventoryText } from "../testing/guardrail-support.js";

// The hook as the host runs it: the bare-glob rule resolves from the call's
// directory, through the injected filesystem, and only warns.
async function guard(payload: unknown, seeded: string[]) {
  const h = testHarness({
    env: { CLAUDE_PROJECT_DIR: "/repo", KORE_ROOT: "/repo" },
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

  it("resolves from the project root when the payload carries no directory", async () => {
    const result = await guard(bare(), ["/repo/infra/a.yaml"]);
    expect(result.out).toBe("");
  });
});
