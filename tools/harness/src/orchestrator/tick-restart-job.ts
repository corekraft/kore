import { join } from "node:path";

/** The launchd label of the owner's restart job for the tick loop (idea 0007). */
export const TICK_JOB_LABEL = "com.corekraft.kore.orchestrate-tick";

/** What the restart job runs: this checkout's harness, from its root, with its log. */
export interface RestartJob {
  /** The node binary that runs the harness. */
  node: string;
  /** The harness bundle of the checkout the job is installed from. */
  harness: string;
  /** The checkout the loop runs from. */
  root: string;
  /** Where the loop's output goes. */
  log: string;
}

/** The owner's LaunchAgents file for the job; written by the installer and loaded only by the owner. */
export function restartJobPath(home: string): string {
  return join(home, "Library", "LaunchAgents", `${TICK_JOB_LABEL}.plist`);
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

function text(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

/**
 * The launchd property list for the loop. It restarts only after a crash
 * (SuccessfulExit false), so a loop that ends because the flag is off stays
 * stopped. Writing it starts nothing; the owner loads it with launchctl.
 */
export function restartJobPlist(job: RestartJob): string {
  const args = [job.node, job.harness, "orchestrate", "tick", "--loop"];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "  <key>Label</key>",
    `  <string>${text(TICK_JOB_LABEL)}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    ...args.map((arg) => `    <string>${text(arg)}</string>`),
    "  </array>",
    "  <key>WorkingDirectory</key>",
    `  <string>${text(job.root)}</string>`,
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "  <key>KeepAlive</key>",
    "  <dict>",
    "    <key>SuccessfulExit</key>",
    "    <false/>",
    "  </dict>",
    "  <key>StandardOutPath</key>",
    `  <string>${text(job.log)}</string>`,
    "  <key>StandardErrorPath</key>",
    `  <string>${text(job.log)}</string>`,
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}
