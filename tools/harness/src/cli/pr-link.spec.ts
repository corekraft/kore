import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mainRoot, type CliDeps } from "../runtime/index.js";
import { linkPullRequest } from "./pr-link.js";

const { record, ledgerConstructor } = vi.hoisted(() => ({
  record: vi.fn<(input: unknown) => Promise<unknown>>(),
  ledgerConstructor: vi.fn<(...args: unknown[]) => void>(),
}));

vi.mock("../ledger/index.js", () => ({
  DEFAULT_LEDGER: ".kore/state/ledger.jsonl",
  Ledger: class {
    constructor(...args: unknown[]) {
      ledgerConstructor(...args);
    }
    record(input: unknown) {
      return record(input);
    }
  },
}));
vi.mock("../runtime/index.js", () => ({
  mainRoot: vi.fn<(deps: unknown) => Promise<string | undefined>>(),
}));

const URL = "https://github.com/corekraft/kore/pull/9";
const WARNED =
  "The pull request is open, but its link to the writer was not recorded";
const WRITER_ENV = { KORE_ROLE: "writer", KORE_AGENT: "fix-x" };

function deps(env: Record<string, string | undefined>) {
  const fs = { appendFile: vi.fn() };
  const ids = { next: () => "id-1" };
  const clock = { now: () => new Date("2026-11-17T10:00:00.000Z") };
  return { env, fs, ids, clock } as unknown as CliDeps;
}

beforeEach(() => {
  record.mockReset();
  record.mockResolvedValue({ ok: true, event: {} });
  ledgerConstructor.mockReset();
  vi.mocked(mainRoot).mockReset();
  vi.mocked(mainRoot).mockResolvedValue("/repo");
});

describe("harness pr open links the pull request to its writer through the ledger", () => {
  it("records one pr.linked event with the pull request number and the writer's session name as session and agent", async () => {
    expect(await linkPullRequest(deps(WRITER_ENV), URL)).toBeUndefined();
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith({
      source: "herdr",
      kind: "pr.linked",
      occurredAt: "2026-11-17T10:00:00.000Z",
      number: 9,
      session: "fix-x",
      agent: "fix-x",
    });
  });

  it("writes into the checkout's ledger, through the Ledger the command owns", async () => {
    const d = deps(WRITER_ENV);
    await linkPullRequest(d, URL);
    expect(ledgerConstructor).toHaveBeenCalledWith(
      d.fs,
      d.clock,
      d.ids,
      join("/repo", ".kore/state/ledger.jsonl"),
    );
  });
});

describe("harness pr open writes no link where there is no writer to link", () => {
  it("writes no link and no warning outside a spawn environment, so the pull request is simply opened", async () => {
    expect(await linkPullRequest(deps({}), URL)).toBeUndefined();
    expect(record).not.toHaveBeenCalled();
  });

  it("writes no link for a session spawned under another role", async () => {
    const judge = { KORE_ROLE: "judge", KORE_AGENT: "judge-test" };
    expect(await linkPullRequest(deps(judge), URL)).toBeUndefined();
    expect(record).not.toHaveBeenCalled();
  });
});

describe("harness pr open never blocks the pull request on a link that fails", () => {
  it("warns, and does not throw, when the ledger refuses the event", async () => {
    record.mockResolvedValue({
      ok: false,
      field: "number",
      message: 'Invalid event: field "number" must be a positive integer.',
    });
    expect(await linkPullRequest(deps(WRITER_ENV), URL)).toBe(
      `${WARNED}: Invalid event: field "number" must be a positive integer.`,
    );
  });

  it("warns, and does not throw, when the ledger write fails with a file error", async () => {
    record.mockRejectedValue(
      Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" }),
    );
    expect(await linkPullRequest(deps(WRITER_ENV), URL)).toBe(
      `${WARNED}: EACCES: permission denied`,
    );
  });

  it("rethrows an error that is not a file error, because it is a bug and not an expected failure", async () => {
    record.mockRejectedValue(new TypeError("record is not a function"));
    await expect(linkPullRequest(deps(WRITER_ENV), URL)).rejects.toThrow(
      "record is not a function",
    );
  });

  it("warns and writes nothing when the main checkout cannot be found", async () => {
    vi.mocked(mainRoot).mockResolvedValue(undefined);
    expect(await linkPullRequest(deps(WRITER_ENV), URL)).toBe(
      `${WARNED}: cannot find the main checkout to keep the ledger in.`,
    );
    expect(record).not.toHaveBeenCalled();
  });

  it("warns and writes nothing when gh's output names no pull request number", async () => {
    const issue = "https://github.com/corekraft/kore/issues/9";
    expect(await linkPullRequest(deps(WRITER_ENV), issue)).toBe(
      `${WARNED}: no pull request number in "${issue}".`,
    );
    expect(record).not.toHaveBeenCalled();
  });
});
