import { describe, expect, it } from "vitest";
import { run } from "../cli/index.js";
import { testHarness } from "../cli/cli-support.js";
import { INVENTORY_PATH } from "../guardrail/index.js";
import { committedInventoryText } from "../testing/guardrail-support.js";
import { CORPUS, ORDINARY, type CorpusCase } from "./guard-corpus.js";

const ROOT = "/repo";

/** The input a corpus case stands for: a command, or a path for a file tool. */
function toolInput(c: Pick<CorpusCase, "tool" | "input">) {
  switch (c.tool) {
    case "Bash":
      return { command: c.input };
    case "Edit":
      return { file_path: c.input, old_string: "a", new_string: "b" };
    case "Write":
      return { file_path: c.input, content: "x" };
    default:
      return { file_path: c.input, path: c.input };
  }
}

function payload(c: Pick<CorpusCase, "role" | "tool" | "input">) {
  return {
    session_id: "s1",
    cwd: ROOT,
    tool_name: c.tool,
    tool_input: toolInput(c),
    ...(c.role === undefined ? {} : { agent_type: c.role }),
  };
}

/** `hook guard` as the host runs it, in process, against the committed guardrail inventory. */
async function hookGuard(call: unknown) {
  const h = testHarness({
    env: { CLAUDE_PROJECT_DIR: ROOT, KORE_ROOT: ROOT },
    files: { [`${ROOT}/${INVENTORY_PATH}`]: committedInventoryText },
  });
  h.deps.stdin = () => Promise.resolve(JSON.stringify(call));
  const code = await run(["hook", "guard"], h.deps);
  return { code, err: h.err() };
}

describe("bypass corpus: every attempt is blocked by hook guard", () => {
  it("names its cases, so a corpus that shrinks fails loudly", () => {
    expect(CORPUS.length).toBeGreaterThan(250);
  });

  it.each(
    CORPUS.map((c) => [`${c.role ?? "no role"}: ${c.tool} ${c.input}`, c]),
  )("%s", async (_name, c) => {
    const result = await hookGuard(payload(c));
    expect(result.code, `ALLOWED: ${JSON.stringify(c)}`).toBe(2);
    expect(result.err).toContain(`[guard:${c.rule}]`);
  });
});

describe("bypass corpus: ordinary calls still pass", () => {
  it.each(
    ORDINARY.map((c) => [`${c.role ?? "no role"}: ${c.tool} ${c.input}`, c]),
  )("%s", async (_name, c) => {
    const result = await hookGuard(payload(c));
    expect(result.code, result.err).toBe(0);
  });
});
