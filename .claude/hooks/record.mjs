#!/usr/bin/env node
// Recording-only hook entry. It never prints and never blocks.
// Usage: record.mjs session-start   (SessionStart, no matcher)
// A session starts on startup, clear or resume; a compaction continues the same
// session, so it is not a start. The context hook keeps its own matcher and
// output and does not record.
// Plan: infra/plans/8-harness-measurement.md#step-3-stage-event-ledger

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { recordEvent } from "./ledger.mjs";

const STARTS = new Set(["startup", "clear", "resume"]);

function main(mode) {
  let event;
  try {
    event = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return 0;
  }
  if (mode === "session-start" && STARTS.has(event?.source)) {
    const root = process.env.CLAUDE_PROJECT_DIR || event.cwd || process.cwd();
    recordEvent("session.start", event, { root });
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv[2]);
}
