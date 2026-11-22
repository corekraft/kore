import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDeps } from "../runtime/index.js";
import {
  FakeTerminals,
  terminalError,
  type TerminalError,
} from "../terminal/index.js";
import { hcMessage } from "./backend.js";
import { checkOnHc } from "./check-hc.js";
import { fakeDeps, type FakeDeps } from "./deps-support.js";
import type { SessionRecords, SessionRegistry } from "./registry.js";
import { reportDirOf } from "./report-file.js";

vi.mock("./backend.js", () => ({
  hcMessage: vi.fn((error: TerminalError) => error.error.message),
}));
vi.mock("./report-file.js", () => ({
  reportDirOf: vi.fn((cwd: string) => `${cwd}/.kore/report`),
}));

const MAIN = "/main";
let deps: FakeDeps;
const all = vi.fn<SessionRegistry["all"]>();
const registry: Pick<SessionRegistry, "all"> = { all };
/** The report directories that exist, and the files in each. */
let reports: Record<string, string[]>;

/**
 * t1 is the main session: a top-level agent, which is not a spawn. t2 is a writer session.
 * t3 is a plain shell under t1. t4 is an agent under t1 that finished. t5 is an agent under t2 with
 * a role label and no kore-session label: the unmanaged one. t6 is an unmanaged agent with no role label.
 */
async function world(): Promise<FakeTerminals> {
  const terminals = new FakeTerminals();
  await terminals.run({ argv: ["claude"], cwd: "/main" });
  terminals.setStatus("t1", "idle");
  await terminals.run({
    argv: ["claude"],
    cwd: "/work/writer",
    name: "image-trust-writer",
    parent: "t1",
    labels: { "kore-session": "image-trust-writer", role: "writer" },
  });
  terminals.setStatus("t2", "working");
  await terminals.run({ argv: ["bash"], cwd: "/work/shell", parent: "t1" });
  await terminals.run({ argv: ["claude"], cwd: "/work/done", parent: "t1" });
  terminals.setStatus("t4", "idle");
  terminals.finish("t4", 0);
  await terminals.run({
    argv: ["claude"],
    cwd: "/work/stray",
    parent: "t2",
    labels: { role: "writer" },
  });
  terminals.setStatus("t5", "working");
  await terminals.run({ argv: ["claude"], cwd: "/work/bare", parent: "t2" });
  terminals.setStatus("t6", "idle");
  return terminals;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(hcMessage).mockImplementation(
    (error: TerminalError) => error.error.message,
  );
  vi.mocked(reportDirOf).mockImplementation(
    (cwd: string) => `${cwd}/.kore/report`,
  );
  deps = fakeDeps();
  reports = {};
  deps.fs.exists.mockImplementation(async (path: string) => path in reports);
  deps.fs.readdir.mockImplementation(async (dir: string) => reports[dir] ?? []);
  all.mockResolvedValue({
    records: [],
    unreadable: [],
  } satisfies SessionRecords);
});

describe("checkOnHc reports an agent terminal that session spawn did not start", () => {
  it("reports each live agent with a parent and no kore-session label, with the role from its role label", async () => {
    const terminals = await world();

    const result = await checkOnHc(
      deps as unknown as CliDeps,
      terminals,
      registry,
      MAIN,
    );

    expect(result).toStrictEqual({
      unmanaged: [
        { terminal: "t5", role: "writer" },
        { terminal: "t6", role: null },
      ],
      orphanReports: [],
    });
  });

  it("says why when hc cannot list its terminals, and checks nothing else", async () => {
    const terminals = new FakeTerminals();
    vi.spyOn(terminals, "list").mockResolvedValue(
      terminalError("unavailable", "hc is not running", "start hc"),
    );

    expect(
      await checkOnHc(deps as unknown as CliDeps, terminals, registry, MAIN),
    ).toStrictEqual({ error: "hc is not running" });
    expect(deps.fs.readdir).not.toHaveBeenCalled();
  });
});

describe("checkOnHc reports a report file with no open record", () => {
  it("reports a report whose session has no open record, and leaves one with an open record", async () => {
    const terminals = await world();
    reports["/main/.kore/report"] = [
      "image-trust-writer.json",
      "old-writer.json",
    ];
    all.mockResolvedValue({
      records: [
        { name: "image-trust-writer", closedAt: undefined },
      ] as unknown as SessionRecords["records"],
      unreadable: [],
    });

    const result = await checkOnHc(
      deps as unknown as CliDeps,
      terminals,
      registry,
      MAIN,
    );

    expect(result).toMatchObject({
      orphanReports: [
        { file: "/main/.kore/report/old-writer.json", name: "old-writer" },
      ],
    });
  });

  it("reports a report whose session is closed, since a closed record is not open", async () => {
    const terminals = await world();
    reports["/main/.kore/report"] = ["closed-one.json"];
    all.mockResolvedValue({
      records: [
        { name: "closed-one", closedAt: "2026-01-02T03:00:00.000Z" },
      ] as unknown as SessionRecords["records"],
      unreadable: [],
    });

    const result = await checkOnHc(
      deps as unknown as CliDeps,
      terminals,
      registry,
      MAIN,
    );

    expect(result).toMatchObject({
      orphanReports: [
        { file: "/main/.kore/report/closed-one.json", name: "closed-one" },
      ],
    });
  });

  it("looks in the checkout of each terminal, and ignores files that are not reports", async () => {
    const terminals = await world();
    reports["/work/writer/.kore/report"] = ["lost.json", "notes.txt"];

    const result = await checkOnHc(
      deps as unknown as CliDeps,
      terminals,
      registry,
      MAIN,
    );

    expect(result).toMatchObject({
      orphanReports: [
        { file: "/work/writer/.kore/report/lost.json", name: "lost" },
      ],
    });
  });
});
