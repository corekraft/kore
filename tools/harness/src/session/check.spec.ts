import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDeps, CommandContext, Runner } from "../runtime/index.js";
import { check } from "./check.js";
import { SessionRegistry, type SessionRecord } from "./registry.js";
import { roleTokensOn } from "./role-token.js";

vi.mock("./role-token.js", () => ({ roleTokensOn: vi.fn() }));
const open = vi.hoisted(() => vi.fn());
vi.mock("./registry.js", () => ({ SessionRegistry: { open } }));

const run = vi.fn<Runner["run"]>();
const read = vi.fn();
const out: string[] = [];
const err: string[] = [];
const deps = {
  runner: { run },
  stdout: (t: string) => out.push(t),
  stderr: (t: string) => err.push(t),
} as unknown as CliDeps;
const context = (json = false): CommandContext => ({
  json,
  deps,
  options: {},
});
const agents = (list: object[]) => ({
  code: 0,
  stdout: JSON.stringify({ result: { agents: list } }),
  stderr: "",
});
const pane = (id: string, title: string, name?: string) => ({
  pane_id: id,
  terminal_title_stripped: title,
  ...(name === undefined ? {} : { name }),
});
const record = (paneId: string, closedAt?: string) =>
  ({ paneId, closedAt }) as unknown as SessionRecord;

beforeEach(() => {
  out.length = 0;
  err.length = 0;
  vi.resetAllMocks();
  vi.mocked(roleTokensOn).mockResolvedValue(true);
  open.mockResolvedValue({ read } as unknown as SessionRegistry);
  read.mockResolvedValue(undefined);
});

describe("session check", () => {
  it("does nothing while the role-tokens flag is off", async () => {
    vi.mocked(roleTokensOn).mockResolvedValue(false);
    expect(await check(context())).toBe(0);
    expect(run).not.toHaveBeenCalled();
    expect(out).toEqual(["role-tokens is off; no role pane was checked.\n"]);
  });

  it("reports a writer pane that session spawn did not start, naming session spawn", async () => {
    run.mockResolvedValue(agents([pane("w3:p4", "writer", "raw-writer")]));
    expect(await check(context())).toBe(1);
    expect(err).toEqual([
      "Pane w3:p4 (raw-writer) runs as a writer but session spawn did not start it, so it has no role token and no sandbox. Close it with `herdr pane close w3:p4` and start it with `session spawn --role writer`.\n",
    ]);
  });

  it("reports an unnamed judge pane", async () => {
    run.mockResolvedValue(agents([pane("w3:p5", "judge")]));
    expect(await check(context())).toBe(1);
    expect(err[0]).toContain("Pane w3:p5 (unnamed) runs as a judge");
  });

  it("accepts a role pane whose open record names that pane", async () => {
    run.mockResolvedValue(agents([pane("w3:p4", "writer", "w")]));
    read.mockResolvedValue(record("w3:p4"));
    expect(await check(context())).toBe(0);
    expect(out).toEqual([
      "Every writer and judge pane was started by session spawn.\n",
    ]);
  });

  it("reports a pane whose record is closed or names another pane", async () => {
    run.mockResolvedValue(
      agents([pane("w3:p4", "writer", "a"), pane("w3:p6", "judge", "b")]),
    );
    read
      .mockResolvedValueOnce(record("w3:p4", "2026-11-15T00:00:00Z"))
      .mockResolvedValueOnce(record("w3:p9"));
    expect(await check(context())).toBe(1);
    expect(err).toHaveLength(2);
  });

  it("ignores panes that are not a writer or judge", async () => {
    run.mockResolvedValue(
      agents([pane("w3:p1", "reader", "r"), pane("w3:p2", "✳ claude")]),
    );
    expect(await check(context())).toBe(0);
    expect(read).not.toHaveBeenCalled();
  });

  it("fails when herdr cannot list agents, and never calls it a pass", async () => {
    run.mockResolvedValue({ code: 1, stdout: "", stderr: "no server" });
    expect(await check(context())).toBe(1);
    expect(err[0]).toContain("herdr agent list failed");
    expect(out).toEqual([]);
  });

  it("prints the offending panes as JSON", async () => {
    run.mockResolvedValue(agents([pane("w3:p4", "writer", "raw")]));
    await check(context(true));
    expect(out).toEqual([
      `${JSON.stringify({ unmanaged: [{ pane: "w3:p4", name: "raw", role: "writer" }] })}\n`,
    ]);
  });
});
