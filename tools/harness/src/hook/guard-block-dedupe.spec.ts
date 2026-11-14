import { describe, expect, it } from "vitest";
import { run } from "../cli/index.js";
import { testHarness } from "../testing/index.js";
import { INVENTORY_PATH } from "../guardrail/index.js";
import { committedInventoryText } from "../testing/index.js";
import { LEDGER } from "./feedback-support.js";

/** The ledger's events from a fake file map, one JSON object per line. */
const ledgerEvents = (files: Map<string, string>) =>
  (files.get(LEDGER) ?? "")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);

/** One ledger and one repository across several hook runs, as in a real session. */
function session() {
  const h = testHarness({
    env: { CLAUDE_PROJECT_DIR: "/repo", KORE_ROOT: "/repo" },
    files: { [`/repo/${INVENTORY_PATH}`]: committedInventoryText },
  });
  return async (sessionId: string, command: string) => {
    h.deps.stdin = () =>
      Promise.resolve(
        JSON.stringify({
          session_id: sessionId,
          tool_name: "Bash",
          tool_input: { command },
        }),
      );
    await run(["hook", "guard"], h.deps);
    return ledgerEvents(h.files).filter((e) => e["kind"] === "guard.block");
  };
}

const DESTRUCTIVE = "k3d cluster delete kore-local";

describe("guard.block counts a stuck call once, not once per retry", () => {
  it("records one block when the same session retries the same blocked command", async () => {
    const block = session();
    await block("s1", DESTRUCTIVE);
    await block("s1", DESTRUCTIVE);
    expect(await block("s1", DESTRUCTIVE)).toHaveLength(1);
  });

  it("records another block for a different command, session or rule", async () => {
    const block = session();
    await block("s1", DESTRUCTIVE);
    await block("s1", `${DESTRUCTIVE} --all`);
    expect(await block("s2", DESTRUCTIVE)).toHaveLength(3);
  });

  it("never stores the command, only a hash of it in the event id", async () => {
    const block = session();
    const [event] = await block("s1", DESTRUCTIVE);
    expect(JSON.stringify(event)).not.toMatch(/k3d|kore-local/);
    expect(event?.["id"]).toMatch(/^guard\.block:s1:destructive:[0-9a-f]{16}$/);
  });
});
