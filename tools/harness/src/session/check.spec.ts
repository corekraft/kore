import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDeps, CommandContext, Runner } from "../runtime/index.js";
import { mainRoot } from "../runtime/index.js";
import { check } from "./check.js";
import { checkOnHc } from "./check-hc.js";
import { SessionRegistry } from "./registry.js";

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

beforeEach(() => {
  out.length = 0;
  err.length = 0;
  vi.resetAllMocks();
  vi.mocked(mainRoot).mockResolvedValue("/main");
  open.mockResolvedValue({ read } as unknown as SessionRegistry);
  read.mockResolvedValue(undefined);
});

describe("session check on hc", () => {
  it("reads hc only, and lists the terminals", async () => {
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
