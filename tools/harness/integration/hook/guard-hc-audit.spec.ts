// The hc writes the guard can only warn on, and the herdr launch it still blocks (plan 16, Step 4). The hook runs in
// process with the committed guardrail inventory; a session record in the main checkout names the writer of an hc
// terminal, and hc confirms that terminal live under the record's name.
import { describe, expect, it } from "vitest";
import { run } from "../../src/cli/index.js";
import { HC_AUDIT, HC_LAUNCH_AUDIT } from "../../src/hook/index.js";
import { INVENTORY_PATH } from "../../src/guardrail/index.js";
import {
  committedInventoryText,
  testHarness,
} from "../../src/testing/index.js";
import type { FakeResponse } from "../../src/testing/index.js";

const ROOT = "/repo";
const WRITER_RECORD = JSON.stringify({
  name: "hc-writer",
  paneId: "",
  backend: "hc",
  terminal: "t7",
  model: "claude-sonnet-5-5",
  role: "writer",
  effort: "high",
  createdAt: "2026-01-02T03:04:05.000Z",
});
const LIVE_WRITER = JSON.stringify({
  id: "t7",
  name: "hc-writer",
  parent: "t3",
  state: "live",
  status: "working",
  labels: { "kore-session": "hc-writer", role: "writer" },
  cwd: ROOT,
});
/** hc answers the terminal t7 as the live writer the record names. */
const HC_CONFIRMS_WRITER: FakeResponse[] = [
  {
    match: (command, args) => command === "hc" && args[0] === "get",
    result: { stdout: LIVE_WRITER },
  },
];

/** The hook guard for one Bash command, run with these env vars, extra files and hc answers. */
async function guard(
  command: string,
  env: Record<string, string>,
  files: Record<string, string>,
  responses: FakeResponse[] = [],
) {
  const h = testHarness({
    env: { CLAUDE_PROJECT_DIR: ROOT, KORE_ROOT: ROOT, ...env },
    files: { [ROOT + "/" + INVENTORY_PATH]: committedInventoryText, ...files },
    responses,
  });
  h.deps.stdin = () =>
    Promise.resolve(
      JSON.stringify({
        session_id: "s1",
        cwd: ROOT,
        tool_name: "Bash",
        tool_input: { command },
      }),
    );
  const code = await run(["hook", "guard"], h.deps);
  return { code, out: h.out(), err: h.err() };
}

/** The guard for one Bash command, run in the hc terminal t7 whose session record names the writer. */
const inWriterTerminal = (command: string) =>
  guard(
    command,
    { HC_TERMINAL_ID: "t7" },
    {
      // The in-memory filesystem has no directories, so the state directory is an entry here and the registry lists the record.
      [ROOT + "/.kore/state/sessions"]: "",
      [ROOT + "/.kore/state/sessions/hc-writer.json"]: WRITER_RECORD,
    },
    HC_CONFIRMS_WRITER,
  );

describe("the writer's raw hc writes in an hc terminal", () => {
  it.each(HC_AUDIT.map((c) => c.input))(
    "warns, and does not block, on %s",
    async (command) => {
      const result = await inWriterTerminal(command);

      expect(result.code, result.err).toBe(0);
      expect(result.out).toContain("[guard:role-hc-raw]");
    },
  );
});

describe("a bare hc launch of claude, in audit mode (plan 16, Step 4)", () => {
  it.each(
    HC_LAUNCH_AUDIT.filter((c) => c.role === undefined).map((c) => c.input),
  )(
    "warns, and does not block, on %s outside an hc terminal",
    async (command) => {
      const result = await guard(command, {}, {});

      expect(result.code, result.err).toBe(0);
      expect(result.out).toContain("[guard:bare-agent-start-hc]");
    },
  );

  it("warns on the writer's hc launch under both its audit rules", async () => {
    const result = await inWriterTerminal(
      "hc run --bg -- claude --agent writer brief",
    );

    expect(result.code, result.err).toBe(0);
    expect(result.out).toContain("[guard:bare-agent-start-hc]");
    expect(result.out).toContain("[guard:role-hc-raw]");
  });

  it("still blocks the herdr launch for the writer under bare-agent-start, the enforced rule", async () => {
    const result = await inWriterTerminal(
      "herdr agent start w3:p2 --permission-mode bypassPermissions",
    );

    expect(result.code).toBe(2);
    expect(result.err).toContain("[guard:bare-agent-start]");
  });

  it("still blocks a herdr launch that follows a warned hc launch, since a warning never softens a block", async () => {
    const result = await inWriterTerminal(
      "hc run --bg -- claude && herdr agent start w3:p2",
    );

    expect(result.code).toBe(2);
    expect(result.err).toContain("[guard:bare-agent-start]");
  });
});
