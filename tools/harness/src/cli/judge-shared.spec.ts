import { beforeEach, describe, expect, it, vi } from "vitest";
import { JudgeError } from "../judge/index.js";
import type { CommandContext } from "../runtime/index.js";
import { failed, FAILED, reviewersOf } from "./judge-shared.js";

const mocks = vi.hoisted(() => ({
  reviewersFor: vi.fn(),
  parseHarnessConfig: vi.fn(),
  bundleMainRoot: vi.fn(),
}));

vi.mock("../judge/index.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  reviewersFor: mocks.reviewersFor,
}));

vi.mock("../flow/index.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  parseHarnessConfig: mocks.parseHarnessConfig,
}));

vi.mock("../runtime/index.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  bundleMainRoot: mocks.bundleMainRoot,
}));

function contextOf(json: boolean) {
  const stderr = vi.fn();
  const context = { json, deps: { stderr } } as unknown as CommandContext;
  return { context, stderr };
}

describe("judge failed", () => {
  it("reports a judge error on stderr and returns the failing exit code", () => {
    const { context, stderr } = contextOf(false);
    expect(failed(context, new JudgeError("boom"))).toBe(FAILED);
    expect(stderr).toHaveBeenCalledWith("boom\n");
  });

  it("writes the error as a JSON line before the message under --json", () => {
    const { context, stderr } = contextOf(true);
    expect(failed(context, new JudgeError("boom"))).toBe(FAILED);
    expect(stderr).toHaveBeenCalledWith('{"error":"boom"}\nboom\n');
  });

  it("rethrows an error that is not a judge error, so a bug is never reported as an expected failure", () => {
    const { context, stderr } = contextOf(false);
    const bug = new Error("bug");
    expect(() => failed(context, bug)).toThrow(bug);
    expect(stderr).not.toHaveBeenCalled();
  });
});

const exists = vi.fn();
const readFile = vi.fn();

/** A context whose only collaborator is the fake filesystem, plus the flag options given. */
const contextWith = (options: Record<string, unknown> = {}) =>
  ({
    options,
    deps: { fs: { exists, readFile } },
  }) as unknown as CommandContext;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.bundleMainRoot.mockResolvedValue("/main");
  mocks.reviewersFor.mockReturnValue(["resolved"]);
  exists.mockResolvedValue(false);
  readFile.mockResolvedValue("{}");
});

describe("judge reviewersOf flag and checkout", () => {
  it("passes a --reviewer flag straight to reviewersFor, without reading the config", async () => {
    const result = await reviewersOf(
      contextWith({ reviewer: "bot-a,bot-b" }),
      "corekraft/kore",
    );
    expect(result).toEqual(["resolved"]);
    expect(mocks.reviewersFor).toHaveBeenCalledWith({
      flag: "bot-a,bot-b",
      owner: "corekraft",
    });
    expect(mocks.bundleMainRoot).not.toHaveBeenCalled();
    expect(exists).not.toHaveBeenCalled();
  });

  it("refuses to choose reviewers when the main checkout cannot be found", async () => {
    mocks.bundleMainRoot.mockResolvedValue(undefined);
    await expect(reviewersOf(contextWith(), "corekraft/kore")).rejects.toThrow(
      JudgeError,
    );
    expect(mocks.reviewersFor).not.toHaveBeenCalled();
  });
});

describe("judge reviewersOf harness config", () => {
  it("falls back to the repository owner when no harness config exists", async () => {
    await reviewersOf(contextWith(), "corekraft/kore");
    expect(exists).toHaveBeenCalledWith("/main/.claude/harness.json");
    expect(readFile).not.toHaveBeenCalled();
    expect(mocks.reviewersFor).toHaveBeenCalledWith({
      configured: undefined,
      owner: "corekraft",
    });
  });

  it("reads reviewerLogins and the owner login from the main checkout's config", async () => {
    exists.mockResolvedValue(true);
    readFile.mockResolvedValue('{"ownerLogin":"junners"}');
    mocks.parseHarnessConfig.mockReturnValue({
      cost: {},
      ownerLogin: "junners",
      reviewerLogins: ["bot-a"],
    });
    await reviewersOf(contextWith(), "corekraft/kore");
    expect(mocks.parseHarnessConfig).toHaveBeenCalledWith(
      '{"ownerLogin":"junners"}',
      ".claude/harness.json",
    );
    expect(mocks.reviewersFor).toHaveBeenCalledWith({
      configured: ["bot-a"],
      owner: "junners",
    });
  });

  it("uses the repository owner when the config names no owner login", async () => {
    exists.mockResolvedValue(true);
    mocks.parseHarnessConfig.mockReturnValue({ cost: {} });
    await reviewersOf(contextWith(), "corekraft/kore");
    expect(mocks.reviewersFor).toHaveBeenCalledWith({
      configured: undefined,
      owner: "corekraft",
    });
  });

  it("refuses an unreadable config, naming it and the --reviewer escape, and trusts no one", async () => {
    exists.mockResolvedValue(true);
    mocks.parseHarnessConfig.mockReturnValue({
      error:
        'Invalid .claude/harness.json: key "reviewerLogins" must be a list.',
    });
    await expect(reviewersOf(contextWith(), "corekraft/kore")).rejects.toThrow(
      'Invalid .claude/harness.json: key "reviewerLogins" must be a list. The judge reads whom to trust from this file; fix it, or pass --reviewer <login>.',
    );
    expect(mocks.reviewersFor).not.toHaveBeenCalled();
  });
});
