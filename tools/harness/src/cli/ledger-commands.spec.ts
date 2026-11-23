import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  Ledger,
  SOURCES,
  isTimestamp,
  pollGithub,
  type ListResult,
  type RecordResult,
} from "../ledger/index.js";
import { mainRoot, type CommandContext } from "../runtime/index.js";
import { ledgerCommands, openLedger } from "./ledger-commands.js";
import {
  EVENT,
  FILTER,
  GITHUB_EVENT,
  HERDR_EVENT,
  LEDGER_PATH,
  MAIN,
  ctx,
} from "./ledger-command-support.js";
import { pollOutcomeSignals, pollerOnly, repoOf } from "./poll-helpers.js";

const { ledgerRecord, ledgerList } = vi.hoisted(() => ({
  ledgerRecord: vi.fn<(input: unknown) => Promise<RecordResult>>(),
  ledgerList: vi.fn<() => Promise<ListResult>>(),
}));

vi.mock("../ledger/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ledger/index.js")>()),
  Ledger: vi.fn(function fakeLedger() {
    return { record: ledgerRecord, list: ledgerList };
  }),
  pollGithub: vi.fn(),
  isTimestamp: vi.fn(),
}));
vi.mock("../runtime/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../runtime/index.js")>()),
  mainRoot: vi.fn(),
}));
vi.mock("./poll-helpers.js");

const AT = "2026-01-02T03:00:00Z";
const NO_ROOT =
  "Cannot find the main checkout root for the shared ledger. Run inside the repository, set KORE_ROOT to its root, or pass --ledger <path>.";
const NO_EVENT =
  "No event given. Pass --source, --kind and --occurred-at, or one JSON event on stdin.\n";
const run = (name: string, context: CommandContext) =>
  ledgerCommands[name]?.run(context);

beforeEach(() => {
  vi.mocked(mainRoot).mockResolvedValue(MAIN);
  vi.mocked(isTimestamp).mockReturnValue(true);
  vi.mocked(repoOf).mockReturnValue("corekraft/kore");
  ledgerRecord.mockResolvedValue({ ok: true, event: EVENT });
  ledgerList.mockResolvedValue({ events: [], skipped: 0 });
});

describe("openLedger", () => {
  it("opens the default ledger under the main checkout root", async () => {
    expect(await openLedger(ctx().context)).toHaveProperty("ledger");
    expect(vi.mocked(Ledger).mock.calls[0]?.[3]).toBe(LEDGER_PATH);
  });

  it("resolves --ledger against the working directory and asks for no root", async () => {
    await openLedger(ctx({ ledger: "out/x.jsonl" }).context);
    expect(mainRoot).not.toHaveBeenCalled();
    expect(vi.mocked(Ledger).mock.calls[0]?.[3]).toBe("/repo/out/x.jsonl");
  });

  it("returns the actionable error when no main checkout root can be found", async () => {
    vi.mocked(mainRoot).mockResolvedValue(undefined);
    expect(await openLedger(ctx().context)).toEqual({ error: NO_ROOT });
  });
});

describe("ledger record", () => {
  it("appends an event built from flags, printing its id and kind", async () => {
    const { context, deps } = ctx({
      source: "claude",
      kind: "session.start",
      "occurred-at": AT,
      session: "s1",
    });
    expect(await run("record", context)).toBe(0);
    expect(ledgerRecord).toHaveBeenCalledWith({
      source: "claude",
      kind: "session.start",
      occurredAt: AT,
      session: "s1",
    });
    expect(deps.stdout).toHaveBeenCalledWith("recorded id-1 session.start\n");
  });

  it("converts a count flag to a number and leaves other values as text", async () => {
    await run("record", ctx({ number: "12", tokens: "x" }).context);
    expect(ledgerRecord).toHaveBeenCalledWith({ number: 12, tokens: "x" });
  });

  it("reads one JSON event from stdin and prints it under --json", async () => {
    const stdin = JSON.stringify({
      source: "herdr",
      kind: "pane.closed",
      occurredAt: AT,
    });
    const { context, deps } = ctx({}, { json: true, stdin });
    expect(await run("record", context)).toBe(0);
    expect(ledgerRecord).toHaveBeenCalledWith(JSON.parse(stdin));
    expect(deps.stdout).toHaveBeenCalledWith(
      `${JSON.stringify({ event: EVENT })}\n`,
    );
  });
  it("refuses a poller-only event before the ledger is opened", async () => {
    vi.mocked(pollerOnly).mockReturnValue("only the poller writes this");
    const { context, deps } = ctx({ source: "github", kind: "pr.merged" });
    expect(await run("record", context)).toBe(1);
    expect(deps.stderr).toHaveBeenCalledWith("only the poller writes this\n");
    expect(mainRoot).not.toHaveBeenCalled();
  });

  it("reports the ledger's rejection as its message, and as JSON with the field under --json", async () => {
    ledgerRecord.mockResolvedValue({
      ok: false,
      field: "number",
      message: "bad number",
    });
    const plain = ctx({ source: "claude" });
    expect(await run("record", plain.context)).toBe(1);
    expect(plain.deps.stderr).toHaveBeenCalledWith("bad number\n");
    const json = ctx({ source: "claude" }, { json: true });
    expect(await run("record", json.context)).toBe(1);
    expect(json.deps.stderr).toHaveBeenCalledWith(
      `${JSON.stringify({ error: "bad number", field: "number" })}\n`,
    );
  });

  it.each([
    ["  \n", 2, NO_EVENT],
    ["{nope", 1, "Invalid event: stdin is not valid JSON.\n"],
  ])(
    "exits %i and prints the stdin problem for stdin %j, writing nothing",
    async (stdin, code, message) => {
      const { context, deps } = ctx({}, { stdin });
      expect(await run("record", context)).toBe(code);
      expect(deps.stderr).toHaveBeenCalledWith(message);
      expect(ledgerRecord).not.toHaveBeenCalled();
    },
  );
});

describe("ledger list", () => {
  it("prints one line per event with its session or pane when present", async () => {
    ledgerList.mockResolvedValue({ events: [EVENT, HERDR_EVENT], skipped: 0 });
    const { context, deps } = ctx();
    expect(await run("list", context)).toBe(0);
    expect(deps.stdout.mock.calls.map(([t]) => t).join("")).toBe(
      "2026-01-02T03:00:00Z claude session.start s1\n2026-01-02T04:00:00Z herdr pane.spawned w3:p1\n",
    );
  });

  it("prints the events and the skipped count as JSON", async () => {
    ledgerList.mockResolvedValue({ events: [EVENT], skipped: 1 });
    const { context, deps } = ctx({}, { json: true });
    await run("list", context);
    expect(deps.stdout).toHaveBeenCalledWith(
      `${JSON.stringify({ events: [EVENT], skipped: 1 })}\n`,
    );
  });

  it("says how many malformed lines it skipped in human output", async () => {
    ledgerList.mockResolvedValue({ events: [], skipped: 1 });
    const { context, deps } = ctx();
    await run("list", context);
    expect(deps.stdout).toHaveBeenCalledWith(
      "skipped 1 malformed ledger line(s)\n",
    );
  });
  it("passes the flags as one filter, with both time bounds, to the ledger", async () => {
    await run("list", ctx(FILTER).context);
    expect(ledgerList).toHaveBeenCalledWith(FILTER);
  });

  it("refuses an unknown source with exit 2, listing the sources, and reads nothing", async () => {
    const { context, deps } = ctx({ source: "slack" });
    expect(await run("list", context)).toBe(2);
    expect(deps.stderr).toHaveBeenCalledWith(
      `Invalid --source "slack". Sources: ${SOURCES.join(", ")}.\n`,
    );
    expect(ledgerList).not.toHaveBeenCalled();
  });

  it("refuses a malformed --since before reading the ledger", async () => {
    vi.mocked(isTimestamp).mockReturnValue(false);
    const { context, deps } = ctx({ since: "yesterday" });
    expect(await run("list", context)).toBe(2);
    expect(deps.stderr).toHaveBeenCalledWith(
      'Invalid --since "yesterday". Use an ISO 8601 UTC time such as 2026-01-02T03:04:05Z.\n',
    );
    expect(ledgerList).not.toHaveBeenCalled();
  });
});

describe("ledger poll-github", () => {
  it("polls GitHub for the repo from --since and adds the outcome signals to the total", async () => {
    vi.mocked(pollGithub).mockResolvedValue({
      ok: true,
      recorded: 1,
      events: [GITHUB_EVENT],
    });
    vi.mocked(pollOutcomeSignals).mockResolvedValue({
      ok: true,
      recorded: 1,
      events: [GITHUB_EVENT],
    });
    const { context, deps } = ctx({ since: "2026-01-05T00:00:00Z" });
    expect(await run("poll-github", context)).toBe(0);
    expect(pollGithub).toHaveBeenCalledWith(
      expect.objectContaining({
        runner: deps.runner,
        repo: "corekraft/kore",
        since: "2026-01-05T00:00:00Z",
      }),
    );
    expect(pollOutcomeSignals).toHaveBeenCalledWith(
      context,
      expect.anything(),
      "corekraft/kore",
    );
    expect(deps.stdout).toHaveBeenCalledWith("recorded 2 github event(s)\n");
  });

  it("refuses a malformed --repo before polling", async () => {
    vi.mocked(repoOf).mockReturnValue({ error: 'Invalid --repo "nope".' });
    const { context, deps } = ctx({ repo: "nope" });
    expect(await run("poll-github", context)).toBe(2);
    expect(deps.stderr).toHaveBeenCalledWith('Invalid --repo "nope".\n');
    expect(pollGithub).not.toHaveBeenCalled();
  });

  it("names a GitHub failure as the github field, as JSON under --json", async () => {
    vi.mocked(pollGithub).mockResolvedValue({
      ok: false,
      message: "rate limited",
    });
    const { context, deps } = ctx({}, { json: true });
    expect(await run("poll-github", context)).toBe(1);
    expect(deps.stderr).toHaveBeenCalledWith(
      `${JSON.stringify({ error: "rate limited", field: "github" })}\n`,
    );
  });

  it("names a signal failure as the field the signal poll reports", async () => {
    vi.mocked(pollGithub).mockResolvedValue({
      ok: true,
      recorded: 0,
      events: [],
    });
    vi.mocked(pollOutcomeSignals).mockResolvedValue({
      ok: false,
      message: "bad owner",
      field: "config",
    });
    const { context, deps } = ctx({}, { json: true });
    expect(await run("poll-github", context)).toBe(1);
    expect(deps.stderr).toHaveBeenCalledWith(
      `${JSON.stringify({ error: "bad owner", field: "config" })}\n`,
    );
  });
});
