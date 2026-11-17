import { describe, expect, it } from "vitest";
import {
  TICK_JOB_LABEL,
  restartJobPath,
  restartJobPlist,
} from "./tick-restart-job.js";

const JOB = {
  node: "/usr/local/bin/node",
  harness: "/work/kore/skills/bin/harness.mjs",
  root: "/work/kore",
  log: "/Users/owner/Library/Logs/kore-orchestrate-tick.log",
};

describe("tick restart job", () => {
  it("runs the loop from the checkout's own harness, so the restart runs the code it was installed from", () => {
    const plist = restartJobPlist(JOB);

    expect(plist).toContain(`<string>${JOB.node}</string>`);
    expect(plist).toContain(`<string>${JOB.harness}</string>`);
    expect(plist).toContain(
      `<key>WorkingDirectory</key>\n  <string>${JOB.root}</string>`,
    );
    expect(plist).toMatch(
      /<key>ProgramArguments<\/key>\s*<array>\s*<string>\/usr\/local\/bin\/node<\/string>\s*<string>\/work\/kore\/skills\/bin\/harness\.mjs<\/string>\s*<string>orchestrate<\/string>\s*<string>tick<\/string>\s*<string>--loop<\/string>\s*<\/array>/,
    );
  });

  it("restarts only after a crash, so a loop that ends with the flag off is not started again", () => {
    expect(restartJobPlist(JOB)).toContain(
      "<key>KeepAlive</key>\n  <dict>\n    <key>SuccessfulExit</key>\n    <false/>\n  </dict>",
    );
  });

  it("names its label and its log, and starts at load only when the owner loads it", () => {
    const plist = restartJobPlist(JOB);

    expect(plist).toContain(`<string>${TICK_JOB_LABEL}</string>`);
    expect(plist).toContain(`<string>${JOB.log}</string>`);
    expect(plist).toContain("<key>RunAtLoad</key>\n  <true/>");
  });

  it("escapes markup in a path, so a checkout named with & or < cannot break the file", () => {
    const plist = restartJobPlist({ ...JOB, root: "/work/a&b<c>" });

    expect(plist).toContain("<string>/work/a&amp;b&lt;c&gt;</string>");
    expect(plist).not.toContain("/work/a&b<c>");
  });

  it("puts the job in the owner's LaunchAgents folder under its label", () => {
    expect(restartJobPath("/Users/owner")).toBe(
      `/Users/owner/Library/LaunchAgents/${TICK_JOB_LABEL}.plist`,
    );
  });
});
