// Runs the guard hook in process against a chosen inventory.
import { run } from "../cli/index.js";
import { testHarness } from "../testing/index.js";
import { INVENTORY_PATH, type Mode } from "../guardrail/index.js";
import { inventoryWith } from "../testing/index.js";
import { ledgerEvents } from "./feedback-support.js";

export async function guard(
  payload: unknown,
  inventory: string | undefined,
  project = "/repo",
  extra: Record<string, string> = {},
) {
  const h = testHarness({
    env: { CLAUDE_PROJECT_DIR: project, KORE_ROOT: "/repo" },
    files: {
      ...extra,
      ...(inventory === undefined
        ? {}
        : { [`/repo/${INVENTORY_PATH}`]: inventory }),
      "/repo/tools/kore/vitest.config.ts": "thresholds: { statements: 95 }",
    },
  });
  h.deps.stdin = () => Promise.resolve(JSON.stringify(payload));
  const code = await run(["hook", "guard"], h.deps);
  return { code, out: h.out(), err: h.err(), events: ledgerEvents(h.files) };
}

export const bash = (command: string) => ({
  session_id: "s1",
  tool_name: "Bash",
  tool_input: { command },
});
export const auditEvents = (events: Record<string, unknown>[]) =>
  events.filter((e) => e["kind"] === "guard.audit");
export const modes = (m: Record<string, Mode>) => inventoryWith(m);
