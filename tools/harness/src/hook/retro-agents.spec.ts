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

const event = (recordedAt: string, role?: string): LedgerEvent => {
  const base = { id: "e", kind: "session.launch", recordedAt };
  return (role === undefined ? base : { ...base, role }) as LedgerEvent;
};

function depsOf(): CliDeps {
  const used: Pick<CliDeps, "fs" | "clock" | "ids"> = {
    fs: { readdir } as unknown as FileSystem,
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
    };
    expect(await agentSection(depsOf(), "/repo", "2026-11-10", found)).toEqual({
      agents: { known: ["judge", "writer"], launched: [], unused: ["writer"] },
      proposals: { history, items: [] },
    });
    expect(windowStart).toHaveBeenCalledWith("2026-11-10");
    expect(unusedAgents).toHaveBeenCalledWith(["judge", "writer"], []);
    expect(proposalsFor).toHaveBeenCalledWith({
      sessions: 7,
      days: 29,
      skills: ["handoff"],
      agents: ["writer"],
      promotable: ["bare-glob"],
    });
  });
});
