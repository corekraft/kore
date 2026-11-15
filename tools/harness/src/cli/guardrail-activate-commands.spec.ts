// `guardrail activate`: flags in, the activation unit, the idea repository, the ledger and the
// inventory files mocked; gh runs through a fake runner.
// Docs: infra/plans/12-self-improving-loop.md#step-4-guardrail-activation-gate
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GuardrailActivate,
  denyList,
  parseInventory,
  settingsWithDeny,
  type Inventory,
} from "../guardrail/index.js";
import { IdeaRepository } from "../idea/index.js";
import { contextWith, fakeLedger } from "./command-support.js";
import { activate } from "./guardrail-activate-commands.js";
import { repoOf } from "./judge-shared.js";
import { openLedger } from "./ledger-commands.js";
import { ownerLogin } from "./poll-helpers.js";

vi.mock("../guardrail/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../guardrail/index.js")>()),
  GuardrailActivate: vi.fn(),
  parseInventory: vi.fn(),
  denyList: vi.fn(),
  settingsWithDeny: vi.fn(),
}));
vi.mock("../idea/index.js", () => ({
  IdeaRepository: vi.fn(),
  IdeaError: class IdeaError extends Error {},
}));
vi.mock("./ledger-commands.js");
vi.mock("./judge-shared.js");
vi.mock("./poll-helpers.js");

const INVENTORY: Inventory = { guardrails: [] };
const IDEA = { number: "0224", title: "t", path: "p", issue: "224" };
const run = vi.fn();
const readFile = vi.fn();
const writeFile = vi.fn();
const stdout = vi.fn();
const stderr = vi.fn();
const unit = vi.fn();
const get = vi.fn();

const RESULT = {
  rule: "bare-glob",
  from: "audit",
  to: "enforce",
  idea: "0224",
  issue: "224",
  activated: true,
};
const FLAGS = { to: "enforce", idea: "224" };

function ctx(options: Record<string, string | boolean> = FLAGS, json = false) {
  return contextWith(
    {
      runner: { run },
      fs: { readFile, writeFile },
      clock: { now: () => new Date("2026-01-02T03:04:05.000Z") },
      root: () => Promise.resolve("/repo"),
      cwd: "/work",
      stdout,
      stderr,
    },
    options,
    json,
    "bare-glob",
  );
}

type Ports = {
  approvers: string[];
  events(): Promise<unknown>;
  comments(issue: string): Promise<unknown>;
  labels(issue: string): Promise<unknown>;
  comment(issue: string, body: string): Promise<string>;
  writeInventory(text: string): Promise<void>;
  syncDeny(inventory: Inventory): Promise<void>;
  recordEvent(label: string, idea: string): Promise<unknown>;
};
async function ports(): Promise<Ports> {
  await activate.run(ctx());
  return vi.mocked(GuardrailActivate).mock.calls[0]?.[0] as unknown as Ports;
}

beforeEach(() => {
  vi.resetAllMocks();
  readFile.mockResolvedValue("TEXT");
  vi.mocked(parseInventory).mockReturnValue(INVENTORY);
  vi.mocked(repoOf).mockResolvedValue("o/r");
  vi.mocked(ownerLogin).mockResolvedValue("junners");
  vi.mocked(IdeaRepository).mockImplementation(function () {
    return { get } as unknown as IdeaRepository;
  });
  vi.mocked(GuardrailActivate).mockImplementation(function () {
    return { activate: unit } as unknown as GuardrailActivate;
  });
  get.mockResolvedValue(IDEA);
  unit.mockResolvedValue(RESULT);
  vi.mocked(openLedger).mockResolvedValue({ ledger: fakeLedger().ledger });
});

describe("guardrail activate", () => {
  it("hands the rule and target to the unit, with the owner as the only approver", async () => {
    expect(await activate.run(ctx())).toBe(0);
    expect(unit.mock.calls).toEqual([[{ rule: "bare-glob", to: "enforce" }]]);
    expect((await ports()).approvers).toEqual(["junners"]);
    expect(get.mock.calls[0]).toEqual(["224"]);
  });

  it("prints the outcome as JSON with --json, and in words otherwise", async () => {
    await activate.run(ctx(FLAGS, true));
    expect(stdout.mock.calls).toEqual([[`${JSON.stringify(RESULT)}\n`]]);
    stdout.mockClear();
    await activate.run(ctx());
    expect(stdout.mock.calls).toEqual([
      [
        "bare-glob is now in enforce mode, on a person's approval (idea 0224).\n",
      ],
    ]);
  });

  it("exits 1 and prints the reason when the unit refuses, with the mode unchanged", async () => {
    const refused = { ...RESULT, activated: false, reason: "No approval." };
    unit.mockResolvedValue(refused);
    expect(await activate.run(ctx())).toBe(1);
    expect(stderr.mock.calls).toEqual([
      ["No approval. The mode is unchanged.\n"],
    ]);
    expect(await activate.run(ctx(FLAGS, true))).toBe(1);
    expect(stdout.mock.calls.at(-1)).toEqual([`${JSON.stringify(refused)}\n`]);
  });
});

describe("guardrail activate usage and failures", () => {
  it.each([["to"], ["idea"]])(
    "exits 2 naming the usage when --%s is missing, and reads no issue",
    async (flag) => {
      const options: Record<string, string> = { ...FLAGS };
      delete options[flag];
      expect(await activate.run(ctx(options))).toBe(2);
      expect(stderr.mock.calls[0]?.[0]).toContain(`Missing --${flag}`);
      expect(unit).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
    },
  );

  it("exits 1 with the unit's message when it throws an expected error", async () => {
    const { GuardrailError } = await vi.importActual<
      typeof import("../guardrail/index.js")
    >("../guardrail/index.js");
    unit.mockRejectedValue(new GuardrailError("already in enforce mode"));
    expect(await activate.run(ctx(FLAGS, true))).toBe(1);
    expect(stderr.mock.calls).toEqual([
      ['{"error":"already in enforce mode"}\nalready in enforce mode\n'],
    ]);
  });

  it("rethrows an error that is not an expected one", async () => {
    const error = new Error("disk");
    unit.mockRejectedValue(error);
    await expect(activate.run(ctx())).rejects.toBe(error);
  });

  it("refuses when the ledger cannot be opened, before the unit runs", async () => {
    vi.mocked(openLedger).mockResolvedValue({ error: "no root" });
    expect(await activate.run(ctx())).toBe(1);
    expect(stderr.mock.calls).toEqual([["no root\n"]]);
    expect(unit).not.toHaveBeenCalled();
  });

  it("refuses when the owner login cannot be resolved", async () => {
    vi.mocked(ownerLogin).mockResolvedValue({ error: "bad config" });
    expect(await activate.run(ctx())).toBe(1);
    expect(stderr.mock.calls).toEqual([["bad config\n"]]);
    expect(unit).not.toHaveBeenCalled();
  });
});

describe("guardrail activate ports", () => {
  it("reads the requests from the ledger's guardrail.requested events", async () => {
    const fake = fakeLedger([{ label: "a:audit>enforce" }]);
    vi.mocked(openLedger).mockResolvedValue({ ledger: fake.ledger });
    expect(await (await ports()).events()).toEqual([
      { label: "a:audit>enforce" },
    ]);
    expect(fake.list.mock.calls).toEqual([[{ kind: "guardrail.requested" }]]);
  });

  it("records the activation as a claude guardrail.activated event", async () => {
    const fake = fakeLedger([], { ok: false, field: "label", message: "bad" });
    vi.mocked(openLedger).mockResolvedValue({ ledger: fake.ledger });
    const given = await ports();
    expect(await given.recordEvent("a:audit>enforce", "0224")).toEqual({
      ok: false,
      message: "bad",
    });
    expect(fake.write.mock.calls).toEqual([
      [
        {
          source: "claude",
          kind: "guardrail.activated",
          occurredAt: "2026-01-02T03:04:05.000Z",
          idea: "0224",
          label: "a:audit>enforce",
        },
      ],
    ]);
  });

  it("writes the edited inventory to the repository's inventory file", async () => {
    await (await ports()).writeInventory("NEW");
    expect(writeFile.mock.calls).toEqual([
      ["/repo/.claude/guardrails.yaml", "NEW"],
    ]);
  });

  it("regenerates the settings deny list from the changed inventory", async () => {
    vi.mocked(denyList).mockReturnValue(["Bash(x:*)"]);
    vi.mocked(settingsWithDeny).mockReturnValue("SETTINGS");
    readFile.mockResolvedValue("OLD");
    const given = await ports();
    writeFile.mockClear();
    await given.syncDeny(INVENTORY);
    expect(vi.mocked(settingsWithDeny).mock.calls).toEqual([
      ["OLD", ["Bash(x:*)"]],
    ]);
    expect(writeFile.mock.calls).toEqual([
      ["/repo/.claude/settings.json", "SETTINGS"],
    ]);
  });
});

describe("guardrail activate gh ports", () => {
  const VIEW = {
    code: 0,
    stdout: JSON.stringify({
      labels: [{ name: "approved" }],
      comments: [
        { body: "b", createdAt: "t", author: { login: "junners" } },
        { body: "c", createdAt: "u" },
      ],
    }),
    stderr: "",
  };

  it("reads an issue's comments with authors and times, and its label names, through gh", async () => {
    run.mockResolvedValue(VIEW);
    const given = await ports();
    expect(await given.comments("224")).toEqual([
      { body: "b", createdAt: "t", author: "junners" },
      { body: "c", createdAt: "u", author: "" },
    ]);
    expect(await given.labels("224")).toEqual(["approved"]);
    expect(run.mock.calls[0]).toEqual([
      "gh",
      ["issue", "view", "224", "--repo", "o/r", "--json", "comments,labels"],
      { cwd: "/repo" },
    ]);
  });

  it("posts the comment through gh and returns the URL it printed", async () => {
    run.mockResolvedValue({ code: 0, stdout: "https://x/c1\n", stderr: "" });
    expect(await (await ports()).comment("224", "body")).toBe("https://x/c1");
    expect(run.mock.calls).toEqual([
      [
        "gh",
        ["issue", "comment", "224", "--repo", "o/r", "--body", "body"],
        { cwd: "/repo" },
      ],
    ]);
  });

  it("names the failed gh call, so a failure is never read as no approval", async () => {
    run.mockResolvedValue({ code: 1, stdout: "", stderr: "boom\n" });
    const given = await ports();
    await expect(given.comments("224")).rejects.toThrow(
      "gh issue view failed for issue #224: boom. Check `gh auth status` and the issue number, then rerun the same command.",
    );
  });
});
