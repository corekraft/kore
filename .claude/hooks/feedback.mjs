#!/usr/bin/env node
// Feedback hooks: surface formatting, lint, and type errors in the turn that
// introduces them. Plan: infra/plans/3-agent-harness.md (Step 3).
//
// Usage: feedback.mjs post-edit   (PostToolUse on every tool; checks run for Write|Edit only)
//        feedback.mjs stop        (Stop)
//        feedback.mjs tool-failure (PostToolUseFailure; records the failed tool end only)
// Exit 2 with a message on stderr returns the failure to the agent.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { recordEvent } from "./ledger.mjs";

const SOURCE_DIR = "tools/kore/src/";
const BIN = "tools/kore/node_modules/.bin";

export function isTrackedSource(filePath, root) {
  const prefix = `${root}/`;
  const relative = filePath.startsWith(prefix)
    ? filePath.slice(prefix.length)
    : filePath;
  return relative.startsWith(SOURCE_DIR) && relative.endsWith(".ts");
}

const HARNESS_DIRS = ["tools/harness/src/", "tools/harness/tests/"];
const HARNESS_BIN = "tools/harness/node_modules/.bin";

export function isHarnessSource(filePath, root) {
  const prefix = `${root}/`;
  const relative = filePath.startsWith(prefix)
    ? filePath.slice(prefix.length)
    : filePath;
  return (
    HARNESS_DIRS.some((dir) => relative.startsWith(dir)) &&
    relative.endsWith(".ts")
  );
}

const MAX_LINES = 40;

/** Keep the first lines of a report so a large one never floods the agent's context. */
export function bound(output, command) {
  const lines = output.split("\n");
  if (lines.length <= MAX_LINES) return output;
  const cut = lines.length - MAX_LINES;
  return `${lines.slice(0, MAX_LINES).join("\n")}\n... ${cut} more lines cut. Run \`${command}\` to see all.`;
}

const ok = { code: 0, message: "" };
const fail = (message) => ({ code: 2, message });

/** The post-edit checks apply to Write and Edit only; the hook now sees every tool. */
const isEdit = (call) =>
  call?.tool_name === undefined || ["Write", "Edit"].includes(call.tool_name);

export function postEdit(call, deps) {
  if (!isEdit(call)) return ok;
  const filePath = call?.tool_input?.file_path;
  if (typeof filePath !== "string" || !isTrackedSource(filePath, deps.root))
    return ok;

  deps.markChanged();

  const lint = deps.run(`${deps.root}/${BIN}/oxlint`, [
    "--deny-warnings",
    filePath,
  ]);
  if (lint.status !== 0) {
    const details = bound(
      lint.output,
      `${BIN}/oxlint --deny-warnings ${filePath}`,
    );
    return fail(
      `oxlint reported problems in ${filePath}. Fix them before continuing.\n${details}`,
    );
  }
  const format = deps.run(`${deps.root}/${BIN}/prettier`, [
    "--check",
    filePath,
  ]);
  if (format.status !== 0) {
    const details = bound(format.output, `${BIN}/prettier --check ${filePath}`);
    return fail(
      `${filePath} is not formatted. Run \`${BIN}/prettier --write ${filePath}\`.\n${details}`,
    );
  }
  return ok;
}

export function stop(call, deps) {
  if (call?.stop_hook_active || !deps.hasChanged()) return ok;
  const check = deps.run("npm", [
    "--prefix",
    "tools/kore",
    "run",
    "check",
    "--silent",
  ]);
  if (check.status !== 0) {
    const details = bound(check.output, "npm --prefix tools/kore run check");
    return fail(
      `Typecheck failed after your TypeScript changes. Fix it before finishing.\n${details}`,
    );
  }
  deps.clearChanged();
  return ok;
}

export function postEditHarness(call, deps) {
  if (!isEdit(call)) return ok;
  const filePath = call?.tool_input?.file_path;
  if (typeof filePath !== "string" || !isHarnessSource(filePath, deps.root))
    return ok;

  deps.markHarnessChanged();

  const lint = deps.run(`${deps.root}/${HARNESS_BIN}/oxlint`, [
    "--deny-warnings",
    filePath,
  ]);
  if (lint.status !== 0) {
    const details = bound(
      lint.output,
      `${HARNESS_BIN}/oxlint --deny-warnings ${filePath}`,
    );
    return fail(
      `oxlint reported problems in ${filePath}. Fix them before continuing.\n${details}`,
    );
  }
  const format = deps.run(`${deps.root}/${HARNESS_BIN}/prettier`, [
    "--check",
    filePath,
  ]);
  if (format.status !== 0) {
    const details = bound(
      format.output,
      `${HARNESS_BIN}/prettier --check ${filePath}`,
    );
    return fail(
      `${filePath} is not formatted. Run \`mise run format ${filePath}\`.\n${details}`,
    );
  }
  return ok;
}

export function stopHarness(call, deps) {
  if (call?.stop_hook_active || !deps.hasHarnessChanged()) return ok;
  const check = deps.run("npm", [
    "--prefix",
    "tools/harness",
    "run",
    "check",
    "--silent",
  ]);
  if (check.status !== 0) {
    const details = bound(check.output, "npm --prefix tools/harness run check");
    return fail(
      `The harness typecheck failed after your TypeScript changes. Fix it before finishing.\n${details}`,
    );
  }
  deps.clearHarnessChanged();
  return ok;
}

function realDeps(call) {
  const root = process.env.CLAUDE_PROJECT_DIR || call.cwd || process.cwd();
  const marker = join(
    tmpdir(),
    `kore-ts-changed-${call.session_id ?? "default"}`,
  );
  const harnessMarker = join(
    tmpdir(),
    `kore-harness-changed-${call.session_id ?? "default"}`,
  );
  return {
    root,
    run: (command, args) => {
      const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
      return {
        status: result.status ?? 1,
        output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim(),
      };
    },
    markChanged: () => writeFileSync(marker, ""),
    hasChanged: () => existsSync(marker),
    clearChanged: () => rmSync(marker, { force: true }),
    markHarnessChanged: () => writeFileSync(harnessMarker, ""),
    hasHarnessChanged: () => existsSync(harnessMarker),
    clearHarnessChanged: () => rmSync(harnessMarker, { force: true }),
  };
}

function main(mode) {
  let call;
  try {
    call = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return 0;
  }
  const deps = realDeps(call);
  if (mode === "post-edit")
    recordEvent("tool.end", call, { root: deps.root, outcome: "success" });
  if (mode === "tool-failure") {
    recordEvent("tool.end", call, { root: deps.root, outcome: "failure" });
    return 0;
  }
  if (mode === "stop" && !call.stop_hook_active)
    recordEvent("session.stop", call, { root: deps.root });
  const [kore, harness] =
    mode === "stop" ? [stop, stopHarness] : [postEdit, postEditHarness];
  const first = kore(call, deps);
  const result = first.code !== 0 ? first : harness(call, deps);
  if (result.code !== 0) process.stderr.write(`${result.message}\n`);
  return result.code;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv[2]);
}
