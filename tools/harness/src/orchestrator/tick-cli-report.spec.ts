import { describe, expect, it } from "vitest";
import type { FileSystem, Runner } from "../runtime/index.js";
import { TickCli } from "./tick-cli.js";

const SESSIONS = "/main/.kore/state/sessions";
const PLANS = "/main/.kore/state/tick-plans";
const REPORT = "/main/.kore/report/idea-0001-read-r1-q1.json";

/** A TickCli over the files named, whose runner is never asked anything. */
function cli(files: Record<string, string> = {}, checkout?: string) {
  const runner: Runner = { run: () => Promise.reject(new Error("no call")) };
  const fs = {
    exists: (path: string) => Promise.resolve(path in files),
    readFile: (path: string) => Promise.resolve(files[path] ?? ""),
  } as unknown as FileSystem;
  return new TickCli(runner, "/repo", fs, {
    sessions: SESSIONS,
    plans: PLANS,
    checkout: checkout ?? "/repo",
  });
}

describe("TickCli reportOf: an hc session's report, read without consuming it", () => {
  it("gives the summary and plan a finished hc session's report carries", async () => {
    const tick = cli(
      {
        [REPORT]: JSON.stringify({
          seq: 1,
          outcome: "done",
          summary: "the answer",
          at: "2026-11-22T00:00:00.000Z",
          plan: "{}",
        }),
      },
      "/main",
    );

    expect(await tick.reportOf("idea-0001-read-r1-q1")).toStrictEqual({
      summary: "the answer",
      plan: "{}",
    });
  });

  it("gives no report for a session that wrote none", async () => {
    expect(
      await cli({}, "/main").reportOf("idea-0001-judgment-r1"),
    ).toBeUndefined();
  });
});
