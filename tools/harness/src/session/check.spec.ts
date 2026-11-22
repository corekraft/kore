import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDeps, CommandContext, Runner } from "../runtime/index.js";
import { mainRoot } from "../runtime/index.js";
import { check } from "./check.js";
import { checkOnHc } from "./check-hc.js";
import { hcSessionsOn } from "./hc-flag.js";
import { SessionRegistry, type SessionRecord } from "./registry.js";
import { roleTokensOn } from "./role-token.js";

vi.mock("./role-token.js", () => ({ roleTokensOn: vi.fn() }));
vi.mock("./hc-flag.js", () => ({ hcSessionsOn: vi.fn() }));
vi.mock("./check-hc.js", () => ({ checkOnHc: vi.fn() }));
vi.mock("./backend.js", () => ({ terminalsFor: vi.fn() }));
vi.mock("../runtime/index.js", async (original) => ({
  ...(await original<typeof import("../runtime/index.js")>()),
  mainRoot: vi.fn(),
}));
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
  vi.mocked(hcSessionsOn).mockResolvedValue(false);
  vi.mocked(mainRoot).mockResolvedValue("/main");
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

describe("session check on hc, while hc-sessions is on", () => {
  beforeEach(() => {
    vi.mocked(hcSessionsOn).mockResolvedValue(true);
  });

  it("reads hc only: no herdr agent list, and no role-tokens read", async () => {
    vi.mocked(checkOnHc).mockResolvedValue({
      unmanaged: [],
      orphanReports: [],
    });
    await check(context());
    expect(run).not.toHaveBeenCalled();
  });

  it("reports an agent terminal session spawn did not start, with its role, and exits 1", async () => {
    vi.mocked(checkOnHc).mockResolvedValue({
      unmanaged: [{ terminal: "t5", role: "writer" }],
      orphanReports: [],
    });
    expect(await check(context())).toBe(1);
    expect(err).toStrictEqual([
      "Terminal t5 runs an agent (writer) that session spawn did not start, so it has no kore-session label. Stop it with `hc kill t5`, remove it with `hc rm t5`.\n",
    ]);
  });

  it("names a report file with no open session record, and exits 1", async () => {
    vi.mocked(checkOnHc).mockResolvedValue({
      unmanaged: [],
      orphanReports: [{ file: "/main/.kore/report/old.json", name: "old" }],
    });
    expect(await check(context())).toBe(1);
    expect(err).toStrictEqual([
      "Report /main/.kore/report/old.json has no open session record for old; read it, then delete it.\n",
    ]);
  });

  it("says every terminal and report is accounted for, and exits 0", async () => {
    vi.mocked(checkOnHc).mockResolvedValue({
      unmanaged: [],
      orphanReports: [],
    });
    expect(await check(context())).toBe(0);
    expect(out).toStrictEqual([
      "Every agent terminal was started by session spawn, and every report has an open record.\n",
    ]);
  });

  it("prints the hc check as JSON", async () => {
    vi.mocked(checkOnHc).mockResolvedValue({
      unmanaged: [{ terminal: "t5", role: null }],
      orphanReports: [],
    });
    await check(context(true));
    expect(out).toStrictEqual([
      `${JSON.stringify({ unmanaged: [{ terminal: "t5", role: null }], orphanReports: [] })}\n`,
    ]);
  });

  it("says why hc could not list its terminals, and never calls it a pass", async () => {
    vi.mocked(checkOnHc).mockResolvedValue({ error: "hc is not running" });
    expect(await check(context())).toBe(1);
    expect(err).toStrictEqual([
      "session check could not list the hc terminals: hc is not running\n",
    ]);
    expect(out).toStrictEqual([]);
  });
});

describe("session check does not read hc while hc-sessions is off", () => {
  it("runs the herdr check unchanged and never calls the hc check", async () => {
    run.mockResolvedValue(agents([]));
    expect(await check(context())).toBe(0);
    expect(checkOnHc).not.toHaveBeenCalled();
  });
});
