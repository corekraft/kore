import { describe, expect, it } from "vitest";
import type { FileSystem, Runner } from "../runtime/index.js";
import { TickCli } from "./tick-cli.js";

const SESSIONS = "/main/.kore/state/sessions";
const PLANS = "/main/.kore/state/tick-plans";

function cliWith(files: Record<string, string>): TickCli {
  const runner: Runner = {
    run: () => Promise.reject(new Error("no process is expected here")),
  };
  const fs = {
    readdir: (path: string) =>
      path === SESSIONS
        ? Promise.resolve(
            Object.keys(files).map((f) => f.slice(SESSIONS.length + 1)),
          )
        : Promise.reject(Object.assign(new Error("gone"), { code: "ENOENT" })),
    readFile: (path: string) => Promise.resolve(files[path] ?? ""),
  } as unknown as FileSystem;
  return new TickCli(runner, "/repo", fs, {
    sessions: SESSIONS,
    plans: PLANS,
    checkout: "/repo",
  });
}

const file = (name: string) => `${SESSIONS}/${name}.json`;

const record = (name: string, callerPane: string, createdAt: string) =>
  JSON.stringify({
    name,
    paneId: "p",
    callerPane,
    model: "m",
    createdAt,
  });

describe("TickCli attended pane", () => {
  it("is the pane the idea's latest session was spawned from, read from the registry", async () => {
    const cli = cliWith({
      [file("idea-0001-writer")]: record(
        "idea-0001-writer",
        "w3:p1",
        "2026-11-17T09:00:00.000Z",
      ),
      [file("idea-0001-judge-abc")]: record(
        "idea-0001-judge-abc",
        "w3:p7",
        "2026-11-17T10:00:00.000Z",
      ),
      [file("idea-0002-writer")]: record(
        "idea-0002-writer",
        "w9:p9",
        "2026-11-17T11:00:00.000Z",
      ),
    });

    expect(await cli.attendedPane("0001")).toBe("w3:p7");
  });

  it("is undefined when no session was spawned for the idea", async () => {
    const cli = cliWith({
      [file("idea-0002-writer")]: record(
        "idea-0002-writer",
        "w9:p9",
        "2026-11-17T11:00:00.000Z",
      ),
    });

    expect(await cli.attendedPane("0001")).toBeUndefined();
  });
});
