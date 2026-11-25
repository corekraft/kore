// Docs: docs/decisions/0138-publish-signed-configuration-charts-from-main-for-local-proofs.md
import { describe, expect, it, vi } from "vitest";
import { FlagError, parseReleaseLock } from "../flag/index.js";
import type { CommandContext } from "../runtime/index.js";
import { guarded, releaseLock, root, text } from "./flag-command-helpers.js";
import { fakeContext } from "./command-support.js";

vi.mock("../flag/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../flag/index.js")>()),
  parseReleaseLock: vi.fn(),
}));

/** A command context whose file system reads through the given function, and whose options are as given. */
function contextWith(
  readFile: (path: string) => Promise<string>,
  options: CommandContext["options"] = {},
): CommandContext {
  const base = fakeContext({ options });
  return {
    ...base.context,
    deps: {
      ...base.deps,
      fs: { readFile } as unknown as CommandContext["deps"]["fs"],
    },
  };
}

describe("text reads one trimmed option", () => {
  it("returns the option's value without its surrounding spaces", () => {
    expect(text({ environment: "  vps " }, "environment")).toBe("vps");
  });

  // A value the parser never produces (a number) is passed through a cast, to check the guard for it.
  it.each([
    ["a blank string", { environment: "   " }],
    [
      "a value that is not a string",
      { environment: 3 } as unknown as CommandContext["options"],
    ],
    ["no value", {}],
  ])("returns undefined for %s", (_, options) => {
    expect(text(options, "environment")).toBeUndefined();
  });
});

describe("guarded turns a refusal into an exit code", () => {
  it("returns the exit code the action gives", async () => {
    const { context } = fakeContext();
    expect(await guarded(context, () => Promise.resolve(0))).toBe(0);
  });

  it("prints a refusal to stderr as its message and exits 1", async () => {
    const { context, err, out } = fakeContext();
    const refused = () => Promise.reject(new FlagError("boom"));
    expect(await guarded(context, refused)).toBe(1);
    expect(err()).toBe("boom\n");
    expect(out()).toBe("");
  });

  it("prints a refusal as a JSON line before its message with --json", async () => {
    const { context, err } = fakeContext({ json: true });
    const refused = () => Promise.reject(new FlagError("boom"));
    expect(await guarded(context, refused)).toBe(1);
    expect(err()).toBe('{"error":"boom"}\nboom\n');
  });

  it("rethrows an error that is not a refusal, printing nothing", async () => {
    const { context, err } = fakeContext();
    const broken = () => Promise.reject(new Error("unexpected"));
    await expect(guarded(context, broken)).rejects.toThrow("unexpected");
    expect(err()).toBe("");
  });
});

describe("root names the repository root or refuses with its cause", () => {
  it("returns the root the deps name", async () => {
    const { context } = fakeContext();
    expect(await root(context)).toBe("/repo");
  });

  it("turns a root that cannot be found into a refusal carrying the cause", async () => {
    const { context } = fakeContext();
    context.deps.root = () => Promise.reject(new Error("not a repository"));
    await expect(root(context)).rejects.toEqual(
      new FlagError("not a repository"),
    );
  });
});

describe("releaseLock reads the chart lock named by --chart-lock", () => {
  it("returns undefined, and reads nothing, when no lock is named", async () => {
    const readFile = vi.fn();
    expect(await releaseLock(contextWith(readFile), "/repo")).toBeUndefined();
    expect(readFile).not.toHaveBeenCalled();
  });

  it("reads a relative lock from the repository root and parses it", async () => {
    const readFile = vi.fn(() => Promise.resolve("LOCK"));
    vi.mocked(parseReleaseLock).mockReturnValue({
      cilium: { version: "1.0.0", digest: "sha256:aa" },
    });
    const lock = await releaseLock(
      contextWith(readFile, { "chart-lock": "platform-charts.lock.json" }),
      "/repo",
    );
    expect(readFile).toHaveBeenCalledWith("/repo/platform-charts.lock.json");
    expect(parseReleaseLock).toHaveBeenCalledWith(
      "LOCK",
      "platform-charts.lock.json",
    );
    expect(lock).toEqual({ cilium: { version: "1.0.0", digest: "sha256:aa" } });
  });

  it("reads an absolute lock path as given", async () => {
    const readFile = vi.fn(() => Promise.resolve("LOCK"));
    await releaseLock(
      contextWith(readFile, { "chart-lock": "/etc/platform-charts.lock.json" }),
      "/repo",
    );
    expect(readFile).toHaveBeenCalledWith("/etc/platform-charts.lock.json");
  });

  it("refuses a lock that cannot be read, naming the lock and the cause", async () => {
    const readFile = () => Promise.reject(new Error("ENOENT"));
    await expect(
      releaseLock(
        contextWith(readFile, { "chart-lock": "platform-charts.lock.json" }),
        "/repo",
      ),
    ).rejects.toEqual(
      new FlagError(
        "Cannot read the release chart lock platform-charts.lock.json: ENOENT. Pass --chart-lock <platform-charts.lock.json> attached to the release.",
      ),
    );
  });
});
