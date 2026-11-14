import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseHarnessConfig } from "../flow/index.js";
import { Ledger } from "../ledger/index.js";
import { JudgeError, reviewersFor } from "../judge/index.js";
import { bundleMainRoot } from "../runtime/index.js";
import { contextWith, fakeLedger } from "./command-support.js";
import {
  failed,
  FAILED,
  openJudgeLedger,
  prNumber,
  record,
  repoOf,
  reviewersOf,
} from "./judge-shared.js";
import { CLOCK, harnessConfig, reportOf } from "./judge-command-support.js";

vi.mock("node:path");
vi.mock("../flow/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../flow/index.js")>()),
  parseHarnessConfig: vi.fn(),
}));
vi.mock("../judge/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../judge/index.js")>()),
  reviewersFor: vi.fn(),
}));
vi.mock("../ledger/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ledger/index.js")>()),
  Ledger: vi.fn(),
}));
vi.mock("../runtime/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../runtime/index.js")>()),
  bundleMainRoot: vi.fn(),
}));

const MAIN = "/main";
const LEDGER_PATH = "/main/.kore/state/ledger.jsonl";

function contextOf(
  options: Record<string, string | boolean> = {},
  json = false,
) {
  const stderr = vi.fn();
  const run = vi.fn();
  const exists = vi.fn().mockResolvedValue(false);
  const readFile = vi.fn();
  const context = contextWith(
    {
      fs: { exists, readFile },
      clock: CLOCK,
      ids: { ids: true },
      stderr,
      runner: { run },
    },
    options,
    json,
  );
  return { context, stderr, run, exists, readFile };
}

/** Makes `new Ledger(...)` in the unit return a fake that lists these events and records to `write`. */
function ledgerWith(
  events: { label: string; number?: number }[] = [],
  result?: Parameters<typeof fakeLedger>[1],
) {
  const fake = fakeLedger(events, result);
  // A plain function, so `new Ledger(...)` in the unit returns this fake.
  vi.mocked(Ledger).mockImplementation(function () {
    return fake.ledger;
  });
  vi.mocked(bundleMainRoot).mockResolvedValue(MAIN);
  return fake;
}

describe("judge failed", () => {
  it("reports a judge error on stderr and returns the failing exit code", () => {
    const { context, stderr } = contextOf();
    expect(failed(context, new JudgeError("boom"))).toBe(FAILED);
    expect(stderr).toHaveBeenCalledWith("boom\n");
  });

  it("writes the error as a JSON line before the message under --json", () => {
    const { context, stderr } = contextOf({}, true);
    expect(failed(context, new JudgeError("boom"))).toBe(FAILED);
    expect(stderr).toHaveBeenCalledWith('{"error":"boom"}\nboom\n');
  });

  it("rethrows an error that is not a judge error, so a bug is never reported as an expected failure", () => {
    const { context, stderr } = contextOf();
    const bug = new Error("bug");
    expect(() => failed(context, bug)).toThrow(bug);
    expect(stderr).not.toHaveBeenCalled();
  });
});

describe("judge PR number", () => {
  it.each([
    ["42", 42],
    ["1", 1],
  ])("reads the operand %j as PR %i", (operand, pr) => {
    expect(prNumber(operand, "usage")).toBe(pr);
  });

  it.each([[undefined], [""], ["0"], ["-3"], ["4.2"], ["#42"]])(
    "refuses the operand %j and names the usage",
    (operand) => {
      expect(() => prNumber(operand, "Run it like this.")).toThrow(
        new JudgeError("Missing or invalid PR number. Run it like this."),
      );
    },
  );
});

describe("judge ledger", () => {
  it("opens the shared ledger of the main checkout, never the working directory's", async () => {
    const { context } = contextOf();
    vi.mocked(bundleMainRoot).mockResolvedValue(MAIN);
    vi.mocked(resolve).mockReturnValue(LEDGER_PATH);

    await openJudgeLedger(context);
    expect(resolve).toHaveBeenCalledWith(MAIN, expect.any(String));
    expect(Ledger).toHaveBeenCalledWith(
      context.deps.fs,
      CLOCK,
      context.deps.ids,
      LEDGER_PATH,
    );
  });

  it("refuses to open a ledger when the bundle's main checkout is unknown, and says how to fix it", async () => {
    const { context } = contextOf();
    vi.mocked(bundleMainRoot).mockResolvedValue(undefined);

    await expect(openJudgeLedger(context)).rejects.toThrow(
      "Cannot find the main checkout from the harness bundle's location, so there is no ledger to record to. Run the built skills/bin/harness.mjs (mise run harness-build) from inside the repository.",
    );
    expect(Ledger).not.toHaveBeenCalled();
  });
});

describe("judge reviewers from a flag", () => {
  it("passes --reviewer to the judge's reviewer rule, with the repository owner", async () => {
    const { context } = contextOf({ reviewer: "a,b" });
    vi.mocked(reviewersFor).mockReturnValue(["a", "b"]);

    expect(await reviewersOf(context, "corekraft/kore")).toEqual(["a", "b"]);
    expect(reviewersFor).toHaveBeenCalledWith({
      flag: "a,b",
      owner: "corekraft",
    });
    expect(bundleMainRoot).not.toHaveBeenCalled();
  });
});

describe("judge reviewers from the harness config", () => {
  it("reads the config from the main checkout and uses its reviewers and owner", async () => {
    const { context, exists, readFile } = contextOf();
    vi.mocked(bundleMainRoot).mockResolvedValue(MAIN);
    vi.mocked(join).mockReturnValue("/main/harness.yaml");
    exists.mockResolvedValue(true);
    readFile.mockResolvedValue("config");
    vi.mocked(parseHarnessConfig).mockReturnValue(
      harnessConfig({ reviewerLogins: ["bot"], ownerLogin: "owner" }),
    );
    vi.mocked(reviewersFor).mockReturnValue(["bot"]);

    expect(await reviewersOf(context, "corekraft/kore")).toEqual(["bot"]);
    expect(reviewersFor).toHaveBeenCalledWith({
      configured: ["bot"],
      owner: "owner",
    });
  });

  it("falls back to the repository owner when no config file exists", async () => {
    const { context, exists } = contextOf();
    vi.mocked(bundleMainRoot).mockResolvedValue(MAIN);
    vi.mocked(join).mockReturnValue("/main/harness.yaml");
    exists.mockResolvedValue(false);
    vi.mocked(reviewersFor).mockReturnValue(["corekraft"]);

    await reviewersOf(context, "corekraft/kore");
    expect(reviewersFor).toHaveBeenCalledWith({
      configured: undefined,
      owner: "corekraft",
    });
  });

  it("refuses a config it cannot parse, and says to fix it or pass --reviewer", async () => {
    const { context, exists } = contextOf();
    vi.mocked(bundleMainRoot).mockResolvedValue(MAIN);
    vi.mocked(join).mockReturnValue("/main/harness.yaml");
    exists.mockResolvedValue(true);
    vi.mocked(parseHarnessConfig).mockReturnValue({ error: "bad yaml" });

    await expect(reviewersOf(context, "corekraft/kore")).rejects.toThrow(
      "bad yaml The judge reads whom to trust from this file; fix it, or pass --reviewer <login>.",
    );
  });

  it("refuses when the main checkout is unknown, and says how to name reviewers instead", async () => {
    const { context } = contextOf();
    vi.mocked(bundleMainRoot).mockResolvedValue(undefined);

    await expect(reviewersOf(context, "corekraft/kore")).rejects.toThrow(
      "Cannot find the main checkout from the harness bundle's location, so there is no harness config to read reviewers from. Run the built skills/bin/harness.mjs (mise run harness-build) from inside the repository, or pass --reviewer <login>.",
    );
  });
});

describe("judge repository", () => {
  const remoteOf = (stdout: string, code = 0) => ({ stdout, stderr: "", code });

  it.each([
    ["https://github.com/corekraft/kore.git\n", "corekraft/kore"],
    ["git@github.com:corekraft/kore.git\n", "corekraft/kore"],
    ["https://github.com/corekraft/kore/\n", "corekraft/kore"],
  ])("reads %j as the GitHub repository %s", async (stdout, repo) => {
    const { context, run } = contextOf();
    vi.mocked(bundleMainRoot).mockResolvedValue(MAIN);
    vi.mocked(run).mockResolvedValue(remoteOf(stdout));

    expect(await repoOf(context)).toBe(repo);
    expect(vi.mocked(run).mock.calls).toEqual([
      ["git", ["remote", "get-url", "origin"], { cwd: MAIN }],
    ]);
  });

  it("refuses an origin that is not a GitHub repository, and says how to set it", async () => {
    const { context, run } = contextOf();
    vi.mocked(bundleMainRoot).mockResolvedValue(MAIN);
    vi.mocked(run).mockResolvedValue(remoteOf("https://example.com/x.git\n"));

    await expect(repoOf(context)).rejects.toThrow(
      "The main checkout's origin remote is not a GitHub repository (https://example.com/x.git). Set it with `git remote set-url origin <url>`, then rerun.",
    );
  });
});

describe("judge precheck record", () => {
  it("records a new verdict as a github precheck event, with its pattern and idea", async () => {
    const { context } = contextOf();
    const ledger = ledgerWith();
    await record(
      context,
      reportOf({
        pr: 42,
        ok: true,
        pattern: "no-behaviour-change",
        idea: "#193",
      }),
    );
    expect(ledger.write.mock.calls).toEqual([
      [
        {
          source: "github",
          kind: "precheck",
          occurredAt: "2026-01-02T03:04:05.000Z",
          number: 42,
          label: "no-behaviour-change:pass",
          idea: "#193",
        },
      ],
    ]);
  });

  it("labels a verdict with no declared pattern as none, and leaves out an idea that is not a plain reference", async () => {
    const { context } = contextOf();
    const ledger = ledgerWith();
    await record(context, reportOf({ pr: 42, ok: false, idea: "bad idea!" }));
    expect(ledger.write.mock.calls[0]?.[0]).toEqual({
      source: "github",
      kind: "precheck",
      occurredAt: "2026-01-02T03:04:05.000Z",
      number: 42,
      label: "none:fail",
    });
  });

  it("records nothing when the PR's newest verdict already has this label", async () => {
    const { context } = contextOf();
    const ledger = ledgerWith([{ number: 42, label: "none:fail" }]);
    await record(context, reportOf({ pr: 42, ok: false }));
    expect(ledger.write).not.toHaveBeenCalled();
  });

  it("refuses a rejected event, and says to rerun the precheck", async () => {
    const { context } = contextOf();
    ledgerWith([], { ok: false, field: "label", message: "full" });
    await expect(
      record(context, reportOf({ pr: 42, ok: true })),
    ).rejects.toThrow(
      "The precheck ran, but its ledger event was rejected: full Fix the ledger, then rerun `harness judge precheck 42`.",
    );
  });
});
