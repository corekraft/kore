import { describe, expect, it } from "vitest";
import type { FileSystem, Runner } from "../runtime/index.js";
import { TickCli } from "./tick-cli.js";

const SESSIONS = "/main/.kore/state/sessions";

const closed = JSON.stringify({ closedAt: "t" });

describe("TickCli livePanes", () => {
  it("lists every live-proof pane, whatever the ticket, and no idea pane", async () => {
    const files: Record<string, string> = {
      "live-proof-8.json": closed,
      "live-proof-9.json": closed,
      "idea-0001-writer.json": closed,
    };
    const fs = {
      readdir: () => Promise.resolve(Object.keys(files)),
      readFile: (path: string) =>
        Promise.resolve(files[path.slice(SESSIONS.length + 1)] ?? ""),
    } as unknown as FileSystem;
    const cli = new TickCli({} as Runner, "/repo", fs, SESSIONS, "/plans");

    expect(await cli.livePanes()).toEqual([
      { name: "live-proof-8", state: "closed" },
      { name: "live-proof-9", state: "closed" },
    ]);
  });
});
