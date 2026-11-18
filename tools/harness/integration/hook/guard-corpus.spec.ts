import { describe, expect, it } from "vitest";
import { run } from "../../src/cli/index.js";
import {
  CORPUS,
  HELP_ALLOWED,
  HELP_REFUSED_FLAG_OFF,
  HELP_STILL_REFUSED,
  ORDINARY,
  committedInventoryText,
  testHarness,
  type CorpusCase,
} from "../../src/testing/index.js";
import { INVENTORY_PATH } from "../../src/guardrail/index.js";

const ROOT = "/repo";

/** The input a corpus case stands for: a command, or the path fields of a file tool. */
function toolInput(
  c: Pick<CorpusCase, "tool" | "input"> & { pattern?: string },
) {
  switch (c.tool) {
    case "Bash":
      return { command: c.input };
    case "Edit":
      return { file_path: c.input, old_string: "a", new_string: "b" };
    case "Write":
      return { file_path: c.input, content: "x" };
    case "Glob":
      return { pattern: c.pattern ?? c.input, path: c.input };
    case "Grep":
      return { pattern: c.pattern ?? "token", path: c.input };
    default:
      return { file_path: c.input };
  }
}

function payload(
  c: Pick<CorpusCase, "role" | "tool" | "input"> & { pattern?: string },
) {
  return {
    session_id: "s1",
    cwd: ROOT,
    tool_name: c.tool,
    tool_input: toolInput(c),
    ...(c.role === undefined ? {} : { agent_type: c.role }),
  };
}

/** `hook guard` as the host runs it, in process, against the committed guardrail inventory and the given files. */
async function hookGuard(call: unknown, files: Record<string, string> = {}) {
  const h = testHarness({
    env: { CLAUDE_PROJECT_DIR: ROOT, KORE_ROOT: ROOT },
    files: {
      [`${ROOT}/${INVENTORY_PATH}`]: committedInventoryText,
      ...files,
    },
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

/** The local overlay with gated-help-exempt turned on, as the flag reads it (#973). */
const HELP_ON = {
  [`${ROOT}/infra/environments/local/environment.yaml`]: JSON.stringify({
    features: { "gated-help-exempt": true },
  }),
};

const named = (c: Pick<CorpusCase, "role" | "tool" | "input">) =>
  `${c.role ?? "no role"}: ${c.tool} ${c.input}`;

describe("gated-help-exempt off: a writer's help request is refused as today", () => {
  it.each(
    [...HELP_REFUSED_FLAG_OFF, ...HELP_STILL_REFUSED].map((c) => [named(c), c]),
  )("%s", async (_name, c) => {
    const result = await hookGuard(payload(c));
    expect(result.code, `ALLOWED: ${JSON.stringify(c)}`).toBe(2);
    expect(result.err).toContain(`[guard:${c.rule}]`);
  });
});

describe("gated-help-exempt on: a writer's help request passes, and nothing else changes", () => {
  it.each(HELP_ALLOWED.map((c) => [named(c), c]))(
    "allows %s",
    async (_name, c) => {
      const result = await hookGuard(payload(c), HELP_ON);
      expect(result.code, result.err).toBe(0);
    },
  );

  it.each([...HELP_STILL_REFUSED, ...CORPUS].map((c) => [named(c), c]))(
    "still refuses %s",
    async (_name, c) => {
      const result = await hookGuard(payload(c), HELP_ON);
      expect(result.code, `ALLOWED: ${JSON.stringify(c)}`).toBe(2);
      expect(result.err).toContain(`[guard:${c.rule}]`);
    },
  );
});
