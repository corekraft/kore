// `guardrail request` and the ledger-backed `guardrail status`: flags in, the request
// unit, the idea repository and the ledger mocked; gh runs through a fake runner.
// Docs: infra/plans/12-self-improving-loop.md#step-4-guardrail-activation-gate
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GuardrailRequest,
  pendingRequests,
  readInventory,
  type Inventory,
} from "../guardrail/index.js";
import { IdeaRepository } from "../idea/index.js";
import { contextWith, fakeLedger } from "./command-support.js";
import {
  guardrailLedgerCommands,
  loadPending,
} from "./guardrail-request-commands.js";
import { openLedger } from "./ledger-commands.js";
import { repoOf } from "./judge-shared.js";

const wired = vi.hoisted(() => ({
  loaders: [] as unknown[],
  status: { summary: "status" },
}));

vi.mock("../guardrail/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../guardrail/index.js")>()),
  GuardrailRequest: vi.fn(),
  pendingRequests: vi.fn(),
  readInventory: vi.fn(),
  statusWith: (loader: unknown) => {
    wired.loaders.push(loader);
    return wired.status;
  },
}));
vi.mock("../idea/index.js", () => ({
  IdeaRepository: vi.fn(),
  IdeaError: class IdeaError extends Error {},
}));
vi.mock("./ledger-commands.js");
vi.mock("./judge-shared.js");

const INVENTORY: Inventory = { guardrails: [] };
const IDEA = {
  number: "0223",
  title: "t",
  path: "docs/ideas/0223-x.md",
  issue: "223",
};
const request = vi.fn();
const get = vi.fn();
const run = vi.fn();
const readFile = vi.fn();
const stdout = vi.fn();
const stderr = vi.fn();

const FLAGS = {
  to: "enforce",
  idea: "223",
  scan: "scan.json",
  "false-positives": "1",
};

function ctx(options: Record<string, string | boolean> = FLAGS, json = false) {
  return contextWith(
    {
      runner: { run },
      fs: { readFile },
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

const command = () => {
  const found = guardrailLedgerCommands["request"];
  if (found === undefined) {
    throw new Error("no request command");
  }
  return found;
};

const RESULT = {
  rule: "bare-glob",
  to: "enforce",
  idea: "0223",
  posted: true,
  recorded: true,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(readInventory).mockResolvedValue(INVENTORY);
  vi.mocked(repoOf).mockResolvedValue("o/r");
  vi.mocked(IdeaRepository).mockImplementation(function () {
    return { get } as unknown as IdeaRepository;
  });
  vi.mocked(GuardrailRequest).mockImplementation(function () {
    return { request } as unknown as GuardrailRequest;
  });
  get.mockResolvedValue(IDEA);
  request.mockResolvedValue(RESULT);
  readFile.mockResolvedValue('{"rules":{"audit":[]}}');
  vi.mocked(openLedger).mockResolvedValue({ ledger: fakeLedger().ledger });
});

describe("guardrail request", () => {
  it("hands the rule, target, false positives and the parsed scan to the request unit", async () => {
    expect(await command().run(ctx())).toBe(0);
    expect(request.mock.calls).toEqual([
      [
        {
          rule: "bare-glob",
          to: "enforce",
          falsePositives: 1,
          scan: { rules: { audit: [] } },
        },
      ],
    ]);
    expect(readFile.mock.calls).toEqual([["/work/scan.json"]]);
    expect(get.mock.calls).toEqual([["223"]]);
  });

  it("prints the outcome as JSON with --json, and in words otherwise", async () => {
    await command().run(ctx(FLAGS, true));
    expect(stdout.mock.calls).toEqual([[`${JSON.stringify(RESULT)}\n`]]);
    stdout.mockClear();
    await command().run(ctx());
    expect(stdout.mock.calls).toEqual([
      [
        "Requested approval to enforce bare-glob on the issue of idea 0223; the mode is unchanged.\n",
      ],
    ]);
  });

  it("says nothing new was posted on a rerun", async () => {
    request.mockResolvedValue({ ...RESULT, posted: false, recorded: false });
    await command().run(ctx());
    expect(stdout.mock.calls).toEqual([
      [
        "Already requested: bare-glob is waiting on the issue of idea 0223; nothing was posted.\n",
      ],
    ]);
  });
});

describe("guardrail request usage and failures", () => {
  it.each([
    ["to", "Missing --to"],
    ["idea", "Missing --idea"],
    ["scan", "Missing --scan"],
    ["false-positives", "Missing --false-positives"],
  ])(
    "exits 2 naming the usage when --%s is missing, and posts nothing",
    async (flag, text) => {
      const options = Object.fromEntries(
        Object.entries(FLAGS).filter(([key]) => key !== flag),
      );
      expect(await command().run(ctx(options))).toBe(2);
      expect(stderr.mock.calls[0]?.[0]).toContain(text);
      expect(request).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
    },
  );

  it("refuses false positives that are not a whole number", async () => {
    const options = { ...FLAGS, "false-positives": "many" };
    expect(await command().run(ctx(options))).toBe(2);
    expect(stderr.mock.calls[0]?.[0]).toContain(
      "--false-positives must be a whole number",
    );
  });

  it("exits 1 with the message when the scan file is not JSON, and never calls the request unit", async () => {
    readFile.mockResolvedValue("not json");
    expect(await command().run(ctx())).toBe(1);
    expect(stderr.mock.calls[0]?.[0]).toContain(
      "scan.json is not JSON. Pass the output of `harness hook retro-scan --strict`.",
    );
    expect(request).not.toHaveBeenCalled();
  });

  it("exits 1 with the unit's message when it refuses", async () => {
    const { GuardrailError } = await vi.importActual<
      typeof import("../guardrail/index.js")
    >("../guardrail/index.js");
    request.mockRejectedValue(new GuardrailError("no evidence"));
    expect(await command().run(ctx(FLAGS, true))).toBe(1);
    expect(stderr.mock.calls).toEqual([
      ['{"error":"no evidence"}\nno evidence\n'],
    ]);
  });

  it("rethrows an error that is not an expected one", async () => {
    const error = new Error("disk");
    request.mockRejectedValue(error);
    await expect(command().run(ctx())).rejects.toBe(error);
  });
});

describe("guardrail request ports", () => {
  type Ports = {
    events(): Promise<unknown>;
    recordEvent(label: string, idea: string): Promise<unknown>;
    comments(issue: string): Promise<string[]>;
    comment(issue: string, body: string): Promise<string>;
    repo: string;
    idea: unknown;
  };
  async function ports(): Promise<Ports> {
    await command().run(ctx());
    return vi.mocked(GuardrailRequest).mock.calls[0]?.[0] as unknown as Ports;
  }

  it("reads existing requests from the ledger's guardrail.requested events", async () => {
    const fake = fakeLedger([{ label: "a:audit>enforce" }]);
    vi.mocked(openLedger).mockResolvedValue({ ledger: fake.ledger });
    const given = await ports();
    expect(await given.events()).toEqual([{ label: "a:audit>enforce" }]);
    expect(fake.list.mock.calls).toEqual([[{ kind: "guardrail.requested" }]]);
    expect(given.repo).toBe("o/r");
    expect(given.idea).toBe(IDEA);
  });

  it("records the request as a claude guardrail.requested event with the label and idea", async () => {
    const fake = fakeLedger([], { ok: false, field: "label", message: "bad" });
    vi.mocked(openLedger).mockResolvedValue({ ledger: fake.ledger });
    const given = await ports();
    expect(await given.recordEvent("a:audit>enforce", "0223")).toEqual({
      ok: false,
      message: "bad",
    });
    expect(fake.write.mock.calls).toEqual([
      [
        {
          source: "claude",
          kind: "guardrail.requested",
          occurredAt: "2026-01-02T03:04:05.000Z",
          idea: "0223",
          label: "a:audit>enforce",
        },
      ],
    ]);
  });
});

describe("guardrail request gh ports", () => {
  type Ports = {
    comments(issue: string): Promise<string[]>;
    comment(issue: string, body: string): Promise<string>;
  };
  async function ports(): Promise<Ports> {
    await command().run(ctx());
    return vi.mocked(GuardrailRequest).mock.calls[0]?.[0] as unknown as Ports;
  }

  it("reads an issue's comment bodies through gh on the bundle's repository", async () => {
    run.mockResolvedValue({
      code: 0,
      stdout: '{"comments":[{"body":"one"},{"body":"two"}]}',
      stderr: "",
    });
    const given = await ports();
    expect(await given.comments("223")).toEqual(["one", "two"]);
    expect(run.mock.calls).toEqual([
      [
        "gh",
        ["issue", "view", "223", "--repo", "o/r", "--json", "comments"],
        { cwd: "/repo" },
      ],
    ]);
  });

  it("posts the comment through gh and returns the URL it printed", async () => {
    run.mockResolvedValue({ code: 0, stdout: "https://x/c1\n", stderr: "" });
    const given = await ports();
    expect(await given.comment("223", "body")).toBe("https://x/c1");
    expect(run.mock.calls).toEqual([
      [
        "gh",
        ["issue", "comment", "223", "--repo", "o/r", "--body", "body"],
        { cwd: "/repo" },
      ],
    ]);
  });

  it("names the failed gh call and how to retry, so a failure is never read as posted", async () => {
    run.mockResolvedValue({ code: 1, stdout: "", stderr: "boom\n" });
    const given = await ports();
    await expect(given.comment("223", "b")).rejects.toThrow(
      "gh issue comment failed for issue #223: boom. Check `gh auth status` and the issue number, then rerun the same command.",
    );
    await expect(given.comments("223")).rejects.toThrow(
      "gh issue view failed for issue #223: boom. Check `gh auth status` and the issue number, then rerun the same command.",
    );
  });
});

describe("guardrail status with pending requests", () => {
  it("builds status from the ledger-backed loader", () => {
    expect(guardrailLedgerCommands["status"]).toBe(wired.status);
    expect(wired.loaders).toEqual([loadPending]);
  });

  it("filters the ledger's requests against the inventory", async () => {
    const fake = fakeLedger([{ label: "a:audit>enforce" }]);
    vi.mocked(openLedger).mockResolvedValue({ ledger: fake.ledger });
    const waiting = [{ rule: "a", from: "audit", to: "enforce", idea: "0223" }];
    vi.mocked(pendingRequests).mockReturnValue(waiting);
    expect(await loadPending(ctx(), INVENTORY)).toEqual(waiting);
    expect(fake.list.mock.calls).toEqual([[{ kind: "guardrail.requested" }]]);
    expect(vi.mocked(pendingRequests).mock.calls).toEqual([
      [[{ label: "a:audit>enforce" }], INVENTORY],
    ]);
  });

  it("reports no pending requests, and says why on stderr, when no ledger can be opened", async () => {
    vi.mocked(openLedger).mockResolvedValue({ error: "no root" });
    expect(await loadPending(ctx(), INVENTORY)).toEqual([]);
    expect(stderr.mock.calls).toEqual([
      ["Pending requests are not shown: no root\n"],
    ]);
  });
});
