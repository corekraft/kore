// Which agents the ledger shows launched, and how many days of ledger back it.
// The ledger and the file system are mocked.
// Docs: infra/plans/12-self-improving-loop.md (Step 2)

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Ledger, type LedgerEvent } from "../ledger/index.js";
import { mainRoot, type CliDeps, type FileSystem } from "../runtime/index.js";
import { agentSection, readAgentUsage, skillNames } from "./retro-agents.js";
import { proposalsFor, unusedAgents } from "./retro-proposals.js";
import { windowStart } from "./retro-scan.js";

vi.mock("../runtime/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../runtime/index.js")>()),
  mainRoot: vi.fn(),
}));
vi.mock("../ledger/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ledger/index.js")>()),
  Ledger: vi.fn(),
}));

vi.mock("./retro-proposals.js", () => ({
  proposalsFor: vi.fn(),
  unusedAgents: vi.fn(),
}));
vi.mock("./retro-scan.js", () => ({ windowStart: vi.fn() }));

const list = vi.fn<Ledger["list"]>();
const readdir = vi.fn<FileSystem["readdir"]>();
const readFile = vi.fn<FileSystem["readFile"]>();

const missing = () =>
  Promise.reject(Object.assign(new Error("missing"), { code: "ENOENT" }));

const event = (recordedAt: string, role?: string): LedgerEvent => {
  const base = { id: "e", kind: "session.launch", recordedAt };
  return (role === undefined ? base : { ...base, role }) as LedgerEvent;
};

function depsOf(): CliDeps {
  const used: Pick<CliDeps, "fs" | "clock" | "ids"> = {
    fs: { readdir, readFile } as unknown as FileSystem,
    clock: { now: () => new Date("2026-11-30T00:00:00Z"), sleep: vi.fn() },
    ids: { next: () => "x" },
  };
  return used as CliDeps;
}

beforeEach(() => {
  vi.mocked(mainRoot).mockResolvedValue("/main");
  vi.mocked(Ledger).mockImplementation(function () {
    return { list } as unknown as Ledger;
  });
  readdir.mockResolvedValue(["writer.md", "judge.md", "notes.txt"]);
  readFile.mockImplementation(missing);
  list.mockResolvedValue({ events: [], skipped: 0 });
});

describe("readAgentUsage", () => {
  it("names the agent definitions, the roles launched in the window and the ledger's age in days", async () => {
    list.mockResolvedValue({
      events: [
        event("2026-11-12T00:00:00Z", "writer"),
        event("2026-11-20T00:00:00Z", "writer"),
        event("2026-11-01T00:00:00Z", "judge"),
      ],
      skipped: 0,
    });
    expect(
      await readAgentUsage(
        depsOf(),
        "/repo",
        Date.parse("2026-11-10T00:00:00Z"),
      ),
    ).toEqual({
      known: ["judge", "writer"],
      launched: ["writer"],
      ledgerDays: 29,
    });
    expect(readdir).toHaveBeenCalledWith("/repo/.claude/agents");
  });

  it("treats a missing .claude/agents directory as no known agents", async () => {
    readdir.mockRejectedValue(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
    );
    expect(await readAgentUsage(depsOf(), "/repo", 0)).toEqual({
      known: [],
      launched: [],
      ledgerDays: 0,
    });
  });

  it("rethrows an agents read fault that is not a missing directory", async () => {
    readdir.mockRejectedValue(
      Object.assign(new Error("denied"), { code: "EACCES" }),
    );
    await expect(readAgentUsage(depsOf(), "/repo", 0)).rejects.toMatchObject({
      code: "EACCES",
    });
  });

  it("reports no days and no launches when the ledger root is unknown", async () => {
    vi.mocked(mainRoot).mockResolvedValue(undefined);
    expect(await readAgentUsage(depsOf(), "/repo", 0)).toEqual({
      known: ["judge", "writer"],
      launched: [],
      ledgerDays: 0,
    });
  });
});

describe("skillNames", () => {
  const fsOf = (parts: Partial<Record<keyof FileSystem, unknown>>) =>
    parts as unknown as FileSystem;

  it("lists the folders under skills/ that hold a SKILL.md", async () => {
    const fs = fsOf({
      readdir: vi.fn().mockResolvedValue(["tdd", "bin"]),
      isDirectory: vi.fn().mockResolvedValue(true),
      exists: vi.fn((path: string) =>
        Promise.resolve(path === "/repo/skills/tdd/SKILL.md"),
      ),
    });
    expect(await skillNames(fs, "/repo")).toEqual(["tdd"]);
  });

  it("is undefined when there is no skills/ directory", async () => {
    const fs = fsOf({
      readdir: vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
        ),
    });
    expect(await skillNames(fs, "/repo")).toBeUndefined();
  });

  it("rethrows a read fault that is not a missing directory", async () => {
    const fs = fsOf({
      readdir: vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error("denied"), { code: "EACCES" }),
        ),
    });
    await expect(skillNames(fs, "/repo")).rejects.toMatchObject({
      code: "EACCES",
    });
  });
});

describe("agentSection", () => {
  it("hands the scan's findings and the ledger's days to the proposals, and reports what they return", async () => {
    vi.mocked(windowStart).mockReturnValue(Date.parse("2026-11-10T00:00:00Z"));
    list.mockResolvedValue({
      events: [event("2026-11-01T00:00:00Z", "judge")],
      skipped: 0,
    });
    vi.mocked(unusedAgents).mockReturnValue(["writer"]);
    const history = {
      minDays: 14,
      minSessions: 100,
      days: 29,
      sessions: 7,
      sufficient: false,
    };
    vi.mocked(proposalsFor).mockReturnValue({ history, proposals: [] });
    const found = {
      sessions: { count: 7 },
      skills: { unused: ["handoff"] },
      rules: { promotable: ["bare-glob"] },
      subagents: {},
    };
    expect(await agentSection(depsOf(), "/repo", "2026-11-10", found)).toEqual({
      agents: {
        known: ["judge", "writer"],
        launched: [],
        inProcess: {},
        unused: ["writer"],
      },
      proposals: { history, items: [] },
    });
    expect(windowStart).toHaveBeenCalledWith("2026-11-10");
    expect(unusedAgents).toHaveBeenCalledWith(["judge", "writer"], []);
    expect(proposalsFor).toHaveBeenCalledWith({
      sessions: 7,
      days: 29,
      minDays: 14,
      minSessions: 100,
      skills: ["handoff"],
      agents: ["writer"],
      promotable: ["bare-glob"],
    });
  });
});

describe("agentSection retro history minimums", () => {
  const found = {
    sessions: { count: 7 },
    skills: { unused: [] },
    rules: { promotable: [] },
    subagents: {},
  };

  beforeEach(() => {
    vi.mocked(windowStart).mockReturnValue(0);
    vi.mocked(unusedAgents).mockReturnValue([]);
    vi.mocked(proposalsFor).mockReturnValue({
      history: {
        minDays: 7,
        minSessions: 50,
        days: 0,
        sessions: 7,
        sufficient: false,
      },
      proposals: [],
    });
  });

  it("reads both minimums from the harness config under the repository root", async () => {
    readFile.mockResolvedValue(
      JSON.stringify({ retro: { minDays: 7, minSessions: 50 } }),
    );
    await agentSection(depsOf(), "/repo", undefined, found);
    expect(readFile).toHaveBeenCalledWith("/repo/.claude/harness.json");
    expect(proposalsFor).toHaveBeenCalledWith(
      expect.objectContaining({ minDays: 7, minSessions: 50 }),
    );
  });

  it("keeps the default minimums when the config sets only one of them", async () => {
    readFile.mockResolvedValue(JSON.stringify({ retro: { minSessions: 50 } }));
    await agentSection(depsOf(), "/repo", undefined, found);
    expect(proposalsFor).toHaveBeenCalledWith(
      expect.objectContaining({ minDays: 14, minSessions: 50 }),
    );
  });

  it("keeps the default minimums when there is no harness config", async () => {
    await agentSection(depsOf(), "/repo", undefined, found);
    expect(proposalsFor).toHaveBeenCalledWith(
      expect.objectContaining({ minDays: 14, minSessions: 100 }),
    );
  });

  it("refuses a bad config before any proposal, naming the key and the fix", async () => {
    readFile.mockResolvedValue(JSON.stringify({ retro: { minDays: 0 } }));
    await expect(
      agentSection(depsOf(), "/repo", undefined, found),
    ).rejects.toThrow(/key "retro\.minDays" must be a whole number/);
    expect(proposalsFor).not.toHaveBeenCalled();
  });
});

describe("agentSection in-process launches", () => {
  const found = (subagents: Record<string, number>) => ({
    sessions: { count: 7 },
    skills: { unused: [] },
    rules: { promotable: [] },
    subagents,
  });

  beforeEach(() => {
    vi.mocked(windowStart).mockReturnValue(0);
    vi.mocked(unusedAgents).mockReturnValue([]);
    vi.mocked(proposalsFor).mockReturnValue({
      history: {
        minDays: 14,
        minSessions: 100,
        days: 0,
        sessions: 7,
        sufficient: false,
      },
      proposals: [],
    });
  });

  it("reports in-process launches of known agents apart from pane launches, and counts both as launched", async () => {
    list.mockResolvedValue({
      events: [event("2026-11-01T00:00:00Z", "judge")],
      skipped: 0,
    });
    readdir.mockResolvedValue(["judge.md", "principles-review.md"]);
    const section = await agentSection(
      depsOf(),
      "/repo",
      undefined,
      found({ "principles-review": 528, "general-purpose": 3 }),
    );
    expect(section.agents).toEqual({
      known: ["judge", "principles-review"],
      launched: ["judge"],
      inProcess: { "principles-review": 528 },
      unused: [],
    });
    expect(unusedAgents).toHaveBeenCalledWith(
      ["judge", "principles-review"],
      ["judge", "principles-review"],
    );
  });

  it("keeps pane launches counted when no subagent ran", async () => {
    list.mockResolvedValue({
      events: [event("2026-11-01T00:00:00Z", "judge")],
      skipped: 0,
    });
    const section = await agentSection(depsOf(), "/repo", undefined, found({}));
    expect(section.agents.launched).toEqual(["judge"]);
    expect(section.agents.inProcess).toEqual({});
  });
});
