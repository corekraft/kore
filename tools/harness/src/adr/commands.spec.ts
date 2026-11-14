import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Command } from "../runtime/index.js";
import { Adrs, AdrError, type AdrReport } from "./adr.js";
import { adrCommands } from "./commands.js";
import { ROOT, fakeClock, fakeDeps, fakeFileSystem } from "./adr-support.js";
import { Supersession, type SupersedeReport } from "./supersede.js";

vi.mock("./adr.js", async (original) => ({
  ...(await original<typeof import("./adr.js")>()),
  Adrs: vi.fn(),
}));
vi.mock("./supersede.js", () => ({ Supersession: vi.fn() }));

const create = vi.fn<Adrs["create"]>();
const supersede = vi.fn<Supersession["supersede"]>();

const ADR_REPORT: AdrReport = {
  dryRun: false,
  number: "0004",
  files: [
    {
      path: "docs/decisions/0004-tools.md",
      lines: [
        { number: 1, text: "---" },
        { number: 16, text: "## Consequences" },
      ],
    },
    { path: "docs/index.md", lines: [{ number: 11, text: "- entry" }] },
  ],
};
const SUPERSEDE_REPORT: SupersedeReport = {
  dryRun: false,
  old: "0001",
  new: "0003",
  files: [
    {
      path: "docs/decisions/0001-first.md",
      lines: [
        { number: 2, text: "status: superseded" },
        { number: 3, text: "superseded-by: docs/decisions/0003-third.md" },
      ],
    },
  ],
};

const NEW_FLAGS = {
  title: "Tools",
  summary: "Tools are great.",
  status: "proposed",
  source: "infra/plans/x.md#step-1",
};

function command(name: string): Command {
  const found = adrCommands[name];
  if (found === undefined) {
    throw new Error(`no ${name} command`);
  }
  return found;
}

beforeEach(() => {
  vi.mocked(Adrs).mockImplementation(function () {
    return { create } as unknown as Adrs;
  });
  vi.mocked(Supersession).mockImplementation(function () {
    return { supersede } as unknown as Supersession;
  });
  create.mockResolvedValue(ADR_REPORT);
  supersede.mockResolvedValue(SUPERSEDE_REPORT);
});

describe("adr new through the command table", () => {
  it("creates the ADR in the repository root and prints what it wrote", async () => {
    const fs = fakeFileSystem();
    const clock = fakeClock(new Date(0));
    const { deps, mocks } = fakeDeps(fs, clock);
    expect(
      await command("new").run({ json: false, options: NEW_FLAGS, deps }),
    ).toBe(0);
    expect(vi.mocked(Adrs).mock.calls).toEqual([[fs, clock, ROOT]]);
    expect(create.mock.calls).toEqual([
      [
        {
          title: "Tools",
          summary: "Tools are great.",
          status: "proposed",
          source: "infra/plans/x.md#step-1",
        },
        false,
      ],
    ]);
    expect(mocks.stdout).toHaveBeenCalledWith(
      "Wrote docs/decisions/0004-tools.md (lines 1-16)\nWrote docs/index.md (lines 11-11)\n",
    );
  });

  it("prints the report as JSON with --json", async () => {
    const { deps, mocks } = fakeDeps();
    await command("new").run({ json: true, options: NEW_FLAGS, deps });
    expect(mocks.stdout).toHaveBeenCalledWith(
      `${JSON.stringify(ADR_REPORT)}\n`,
    );
  });
});

describe("adr new flags through the command table", () => {
  it("says Would write and passes dry-run through with --dry-run", async () => {
    const { deps, mocks } = fakeDeps();
    create.mockResolvedValue({ ...ADR_REPORT, dryRun: true });
    await command("new").run({
      json: false,
      options: { ...NEW_FLAGS, "dry-run": true },
      deps,
    });
    expect(create.mock.calls[0]?.[1]).toBe(true);
    expect(mocks.stdout).toHaveBeenCalledWith(
      "Would write docs/decisions/0004-tools.md (lines 1-16)\nWould write docs/index.md (lines 11-11)\n",
    );
  });

  it("trims the refines flag and passes it only when given", async () => {
    const { deps } = fakeDeps();
    await command("new").run({
      json: false,
      options: { ...NEW_FLAGS, refines: "  ADR 0001 " },
      deps,
    });
    expect(create.mock.calls[0]?.[0]).toEqual({
      title: "Tools",
      summary: "Tools are great.",
      status: "proposed",
      source: "infra/plans/x.md#step-1",
      refines: "ADR 0001",
    });
  });
});

describe("adr new refusals through the command table", () => {
  it("names a missing required flag and exits 1 without creating", async () => {
    const { deps, mocks } = fakeDeps();
    const code = await command("new").run({
      json: false,
      options: { ...NEW_FLAGS, title: "  " },
      deps,
    });
    expect(code).toBe(1);
    expect(mocks.stderr).toHaveBeenCalledWith(
      "--title is required; pass --title <text>.\n",
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("reports a refusal as a JSON error with --json", async () => {
    const { deps, mocks } = fakeDeps();
    create.mockRejectedValue(new AdrError("--title is required."));
    expect(
      await command("new").run({ json: true, options: NEW_FLAGS, deps }),
    ).toBe(1);
    expect(mocks.stderr).toHaveBeenCalledWith(
      '{"error":"--title is required."}\n',
    );
  });

  it("names the cause and exits 1 when no repository root is found", async () => {
    const { deps, mocks } = fakeDeps();
    vi.mocked(mocks.root).mockRejectedValue(
      new Error("Cannot find the repo root: x"),
    );
    expect(
      await command("new").run({ json: false, options: NEW_FLAGS, deps }),
    ).toBe(1);
    expect(mocks.stderr).toHaveBeenCalledWith("Cannot find the repo root: x\n");
    expect(create).not.toHaveBeenCalled();
  });

  it("rethrows an error that is not an ADR refusal", async () => {
    const { deps, mocks } = fakeDeps();
    create.mockRejectedValue(new Error("disk full"));
    await expect(
      command("new").run({ json: false, options: NEW_FLAGS, deps }),
    ).rejects.toThrow(new Error("disk full"));
    expect(mocks.stderr).not.toHaveBeenCalled();
  });
});

describe("adr supersede through the command table", () => {
  it("marks the old ADR superseded and prints the change", async () => {
    const { deps, mocks } = fakeDeps();
    expect(
      await command("supersede").run({
        json: false,
        options: { old: "1", new: "3" },
        deps,
      }),
    ).toBe(0);
    expect(supersede.mock.calls).toEqual([["1", "3", false]]);
    expect(mocks.stdout).toHaveBeenCalledWith(
      "Set docs/decisions/0001-first.md to status superseded, superseded-by ADR 0003\n",
    );
  });

  it("says Would set and passes dry-run through with --dry-run", async () => {
    const { deps, mocks } = fakeDeps();
    supersede.mockResolvedValue({ ...SUPERSEDE_REPORT, dryRun: true });
    await command("supersede").run({
      json: false,
      options: { old: "1", new: "3", "dry-run": true },
      deps,
    });
    expect(supersede.mock.calls).toEqual([["1", "3", true]]);
    expect(mocks.stdout).toHaveBeenCalledWith(
      "Would set docs/decisions/0001-first.md to status superseded, superseded-by ADR 0003\n",
    );
  });

  it("prints the report as JSON with --json", async () => {
    const { deps, mocks } = fakeDeps();
    await command("supersede").run({
      json: true,
      options: { old: "1", new: "3" },
      deps,
    });
    expect(mocks.stdout).toHaveBeenCalledWith(
      `${JSON.stringify(SUPERSEDE_REPORT)}\n`,
    );
  });

  it("names a missing --new and exits 1 without superseding", async () => {
    const { deps, mocks } = fakeDeps();
    expect(
      await command("supersede").run({
        json: false,
        options: { old: "1" },
        deps,
      }),
    ).toBe(1);
    expect(mocks.stderr).toHaveBeenCalledWith(
      "--new is required; pass --new <number>.\n",
    );
    expect(supersede).not.toHaveBeenCalled();
  });
});

describe("the adr command table", () => {
  it("registers new and supersede, each declaring the flags it reads", () => {
    expect(Object.keys(adrCommands)).toEqual(["new", "supersede"]);
    expect(command("new").options).toEqual({
      title: "string",
      summary: "string",
      status: "string",
      source: "string",
      refines: "string",
      "dry-run": "boolean",
    });
    expect(command("supersede").options).toEqual({
      old: "string",
      new: "string",
      "dry-run": "boolean",
    });
  });
});
