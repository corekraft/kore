#!/usr/bin/env node
// Feedback hooks: surface formatting, lint, and type errors in the turn that
// introduces them. Plan: infra/plans/3-agent-harness.md (Step 3).
//
// Usage: feedback.mjs post-edit   (PostToolUse on Write|Edit)
//        feedback.mjs stop        (Stop)
// Exit 2 with a message on stderr returns the failure to the agent.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_DIR = "tools/kore/src/";
const BIN = "tools/kore/node_modules/.bin";

export function isTrackedSource(filePath, root) {
  const prefix = `${root}/`;
  const relative = filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath;
  return relative.startsWith(SOURCE_DIR) && relative.endsWith(".ts");
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

export function postEdit(call, deps) {
  const filePath = call?.tool_input?.file_path;
  if (typeof filePath !== "string" || !isTrackedSource(filePath, deps.root)) return ok;

  deps.markChanged();

  const lint = deps.run(`${deps.root}/${BIN}/oxlint`, ["--deny-warnings", filePath]);
  if (lint.status !== 0) {
    const details = bound(lint.output, `${BIN}/oxlint --deny-warnings ${filePath}`);
    return fail(`oxlint reported problems in ${filePath}. Fix them before continuing.\n${details}`);
  }
  const format = deps.run(`${deps.root}/${BIN}/prettier`, ["--check", filePath]);
  if (format.status !== 0) {
    const details = bound(format.output, `${BIN}/prettier --check ${filePath}`);
    return fail(`${filePath} is not formatted. Run \`${BIN}/prettier --write ${filePath}\`.\n${details}`);
  }
  return ok;
}

export function stop(call, deps) {
  if (call?.stop_hook_active || !deps.hasChanged()) return ok;
  const check = deps.run("npm", ["--prefix", "tools/kore", "run", "check", "--silent"]);
  if (check.status !== 0) {
    const details = bound(check.output, "npm --prefix tools/kore run check");
    return fail(`Typecheck failed after your TypeScript changes. Fix it before finishing.\n${details}`);
  }
  deps.clearChanged();
  return ok;
}

function realDeps(call) {
  const root = process.env.CLAUDE_PROJECT_DIR || call.cwd || process.cwd();
  const marker = join(tmpdir(), `kore-ts-changed-${call.session_id ?? "default"}`);
  return {
    root,
    run: (command, args) => {
      const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
      return { status: result.status ?? 1, output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() };
    },
    markChanged: () => writeFileSync(marker, ""),
    hasChanged: () => existsSync(marker),
    clearChanged: () => rmSync(marker, { force: true }),
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
  const result = mode === "stop" ? stop(call, deps) : postEdit(call, deps);
  if (result.code !== 0) process.stderr.write(`${result.message}\n`);
  return result.code;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv[2]);
}
