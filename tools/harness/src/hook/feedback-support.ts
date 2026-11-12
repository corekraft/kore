import { run } from "../cli/index.js";
import { testHarness } from "../cli/cli-support.js";
import type { FakeResponse } from "../runtime/runner-support.js";

export const root = "/repo";
export const KORE_BIN = "/repo/tools/kore/node_modules/.bin";
export const HARNESS_BIN = "/repo/tools/harness/node_modules/.bin";
export const LEDGER = "/repo/.kore/state/ledger.jsonl";

export const edited = (filePath: string, tool = "Edit") => ({
  tool_name: tool,
  tool_input: { file_path: filePath },
  session_id: "s1",
});

export function failing(
  command: string,
  output: string,
  code = 1,
): FakeResponse {
  return {
    match: (c) => c === command,
    result: { code, stdout: output },
  };
}

export async function hook(
  mode: string,
  payload: unknown,
  options: { responses?: FakeResponse[]; marked?: string[] } = {},
) {
  const h = testHarness({
    env: { CLAUDE_PROJECT_DIR: root, KORE_ROOT: root },
    responses: options.responses ?? [],
  });
  for (const project of options.marked ?? []) {
    h.files.set(
      markerPaths(project === "harness" ? "harness" : "ts")[0] ?? "",
      "",
    );
  }
  h.deps.stdin = () => Promise.resolve(JSON.stringify(payload));
  const code = await run(["hook", "feedback", mode], h.deps);
  return {
    code,
    err: h.err(),
    out: h.out(),
    calls: h.runner.calls.map((c) => [c.command, ...c.args]),
    files: h.files,
    events: ledgerEvents(h.files),
  };
}

export const markerPaths = (name: string) => [
  `${tmp()}/kore-${name}-changed-s1`,
  `${tmp()}/kore-${name}-changed-default`,
];
export const tmp = () => (process.env["TMPDIR"] ?? "/tmp").replace(/\/$/, "");

export function ledgerEvents(files: Map<string, string>) {
  const text = files.get(LEDGER) ?? "";
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

export const marked = (files: Map<string, string>, name: string) =>
  markerPaths(name).some((p) => files.has(p));

export const lines = (count: number) =>
  Array.from({ length: count }, (_, i) => `line ${i + 1}`).join("\n");
