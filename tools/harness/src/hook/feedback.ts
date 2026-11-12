// Feedback hooks: surface formatting, lint, and type errors in the turn that
// introduces them. Plan: infra/plans/3-agent-harness.md (Step 3).
//
// Modes: post-edit (PostToolUse on every tool; checks run for Write|Edit only),
// stop (Stop), tool-failure (PostToolUseFailure; records the failed tool end only).
// Exit 2 with a message on stderr returns the failure to the agent.

import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_LEDGER,
  Ledger,
  type Kind,
  type LedgerEvent,
} from "../ledger/index.js";
import { CommandError, mainRoot, type CliDeps } from "../runtime/index.js";
import { readTokens, tokenStateFile } from "./feedback-tokens.js";
import type { HookResult } from "./io.js";

interface Project {
  bin: string;
  project: string;
}
const KORE_SOURCE_DIR = "tools/kore/src/";
const KORE: Project = {
  bin: "tools/kore/node_modules/.bin",
  project: "tools/kore",
};
const HARNESS_SOURCE_DIRS = ["tools/harness/src/", "tools/harness/tests/"];
const HARNESS: Project = {
  bin: "tools/harness/node_modules/.bin",
  project: "tools/harness",
};

function relativeTo(filePath: string, root: string): string {
  const prefix = `${root}/`;
  return filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath;
}

export function isTrackedSource(filePath: string, root: string): boolean {
  const relative = relativeTo(filePath, root);
  return relative.startsWith(KORE_SOURCE_DIR) && relative.endsWith(".ts");
}

export function isHarnessSource(filePath: string, root: string): boolean {
  const relative = relativeTo(filePath, root);
  return (
    HARNESS_SOURCE_DIRS.some((dir) => relative.startsWith(dir)) &&
    relative.endsWith(".ts")
  );
}

const MAX_LINES = 40;

/** Keep the first lines of a report so a large one never floods the agent's context. */
export function bound(output: string, command: string): string {
  const lines = output.split("\n");
  if (lines.length <= MAX_LINES) {
    return output;
  }
  const cut = lines.length - MAX_LINES;
  return `${lines.slice(0, MAX_LINES).join("\n")}\n... ${cut} more lines cut. Run \`${command}\` to see all.`;
}

interface Call {
  tool_name?: unknown;
  tool_input?: { file_path?: unknown };
  stop_hook_active?: unknown;
  session_id?: unknown;
  cwd?: unknown;
  transcript_path?: unknown;
}

const asCall = (payload: unknown): Call =>
  typeof payload === "object" && payload !== null ? (payload as Call) : {};

/** The post-edit checks apply to Write and Edit only; the hook sees every tool. */
const isEdit = (call: Call) =>
  call.tool_name === undefined ||
  call.tool_name === "Write" ||
  call.tool_name === "Edit";

const OK: HookResult = {};
const fail = (message: string): HookResult => ({
  code: 2,
  stderr: `${message}\n`,
});

interface Checked {
  status: number;
  output: string;
}

/** What the checks need: a way to run tools and a marker per project that says its TypeScript changed. */
export interface FeedbackDeps {
  root: string;
  run(command: string, args: readonly string[]): Promise<Checked>;
  mark(project: string): Promise<void>;
  isMarked(project: string): Promise<boolean>;
  clear(project: string): Promise<void>;
}

async function postEditFor(
  call: Call,
  deps: FeedbackDeps,
  project: Project,
  tracked: (filePath: string, root: string) => boolean,
  formatFix: (filePath: string) => string,
): Promise<HookResult> {
  const filePath = call.tool_input?.file_path;
  if (typeof filePath !== "string" || !tracked(filePath, deps.root)) {
    return OK;
  }
  await deps.mark(project.project);
  const lint = await deps.run(`${deps.root}/${project.bin}/oxlint`, [
    "--deny-warnings",
    filePath,
  ]);
  if (lint.status !== 0) {
    const details = bound(
      lint.output,
      `${project.bin}/oxlint --deny-warnings ${filePath}`,
    );
    return fail(
      `oxlint reported problems in ${filePath}. Fix them before continuing.\n${details}`,
    );
  }
  const format = await deps.run(`${deps.root}/${project.bin}/prettier`, [
    "--check",
    filePath,
  ]);
  if (format.status !== 0) {
    const details = bound(
      format.output,
      `${project.bin}/prettier --check ${filePath}`,
    );
    return fail(
      `${filePath} is not formatted. ${formatFix(filePath)}\n${details}`,
    );
  }
  return OK;
}

async function stopFor(
  call: Call,
  deps: FeedbackDeps,
  project: Project,
  message: string,
): Promise<HookResult> {
  if (call.stop_hook_active || !(await deps.isMarked(project.project))) {
    return OK;
  }
  const check = await deps.run("npm", [
    "--prefix",
    project.project,
    "run",
    "check",
    "--silent",
  ]);
  if (check.status !== 0) {
    const details = bound(
      check.output,
      `npm --prefix ${project.project} run check`,
    );
    return fail(`${message}\n${details}`);
  }
  await deps.clear(project.project);
  return OK;
}

export async function postEdit(
  payload: unknown,
  deps: FeedbackDeps,
): Promise<HookResult> {
  const call = asCall(payload);
  if (!isEdit(call)) {
    return OK;
  }
  const kore = await postEditFor(
    call,
    deps,
    KORE,
    isTrackedSource,
    (filePath) => `Run \`${KORE.bin}/prettier --write ${filePath}\`.`,
  );
  if (kore.code !== undefined) {
    return kore;
  }
  return await postEditFor(
    call,
    deps,
    HARNESS,
    isHarnessSource,
    (filePath) => `Run \`mise run format ${filePath}\`.`,
  );
}

export async function stop(
  payload: unknown,
  deps: FeedbackDeps,
): Promise<HookResult> {
  const call = asCall(payload);
  const kore = await stopFor(
    call,
    deps,
    KORE,
    "Typecheck failed after your TypeScript changes. Fix it before finishing.",
  );
  if (kore.code !== undefined) {
    return kore;
  }
  return await stopFor(
    call,
    deps,
    HARNESS,
    "The harness typecheck failed after your TypeScript changes. Fix it before finishing.",
  );
}

/**
 * Appends one Claude event to the ledger. Best effort by contract: a missing
 * ledger root or a rejected event never changes a hook's verdict or output.
 */
async function recordEvent(
  deps: CliDeps,
  kind: Kind,
  call: Call,
  outcome?: "success" | "failure",
  extra: Partial<LedgerEvent> = {},
): Promise<void> {
  try {
    const session = call.session_id;
    if (typeof session !== "string" || session === "") {
      return;
    }
    const main = await mainRoot(deps);
    if (main === undefined) {
      return;
    }
    const pane = deps.env["HERDR_PANE_ID"];
    const event: Partial<LedgerEvent> = {
      source: "claude",
      kind,
      occurredAt: deps.clock.now().toISOString(),
      session,
      ...(typeof pane === "string" && pane !== "" ? { pane } : {}),
      ...(kind.startsWith("tool.") && typeof call.tool_name === "string"
        ? { tool: call.tool_name }
        : {}),
      ...(outcome === undefined ? {} : { outcome }),
      ...extra,
    };
    await new Ledger(
      deps.fs,
      deps.clock,
      deps.ids,
      join(main, DEFAULT_LEDGER),
    ).record(event);
  } catch {
    // Recording is best effort by contract.
  }
}

/** Records the stop, then the session's tokens so far when they grew since the last stop. */
async function recordStop(deps: CliDeps, call: Call): Promise<void> {
  await recordEvent(deps, "session.stop", call);
  const { total, grew } = await readTokens(
    deps.fs,
    call.transcript_path,
    tokenStateFile(call.session_id),
  );
  if (grew && total > 0) {
    await recordEvent(deps, "token.usage", call, undefined, { tokens: total });
  }
}

function feedbackDeps(deps: CliDeps, root: string, call: Call): FeedbackDeps {
  const marker = (project: string) =>
    join(
      tmpdir(),
      `kore-${project === HARNESS.project ? "harness" : "ts"}-changed-${
        typeof call.session_id === "string" ? call.session_id : "default"
      }`,
    );
  return {
    root,
    async run(command, args) {
      const result = await deps.runner.run(command, args, { cwd: root });
      return {
        status: result.code,
        output: `${result.stdout}${result.stderr}`.trim(),
      };
    },
    mark: (project) => deps.fs.writeFile(marker(project), ""),
    isMarked: (project) => deps.fs.exists(marker(project)),
    clear: (project) => deps.fs.remove(marker(project)),
  };
}

export const MODES = ["post-edit", "stop", "tool-failure"];

/** Runs one mode of the feedback hook against the payload the host sent. */
export async function feedback(
  mode: string | undefined,
  payload: unknown,
  deps: CliDeps,
): Promise<HookResult> {
  if (mode === undefined || !MODES.includes(mode)) {
    throw new CommandError(
      `Unknown feedback mode "${mode ?? ""}". Modes: ${MODES.join(", ")}.`,
    );
  }
  if (payload === undefined) {
    return OK;
  }
  const call = asCall(payload);
  const root =
    deps.env["CLAUDE_PROJECT_DIR"] ||
    (typeof call.cwd === "string" && call.cwd !== "" ? call.cwd : deps.cwd);
  if (mode === "tool-failure") {
    await recordEvent(deps, "tool.end", call, "failure");
    return OK;
  }
  // Recording runs beside the checks, so resolving the ledger root (one git
  // call when KORE_ROOT is unset) never adds to the hook's latency.
  let recorded: Promise<void> = Promise.resolve();
  if (mode === "post-edit") {
    recorded = recordEvent(deps, "tool.end", call, "success");
  } else if (!call.stop_hook_active) {
    recorded = recordStop(deps, call);
  }
  const checks = feedbackDeps(deps, root, call);
  try {
    return mode === "stop"
      ? await stop(payload, checks)
      : await postEdit(payload, checks);
  } finally {
    await recorded;
  }
}
