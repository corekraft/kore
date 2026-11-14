import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_COST,
  HARNESS_CONFIG,
  parseHarnessConfig,
} from "../flow/index.js";
import { POLLER_KINDS, pollSignals } from "../ledger/index.js";
import { contextWith, fakeLedger } from "./command-support.js";
import {
  DEFAULT_REPO,
  ownerLogin,
  pollOutcomeSignals,
  pollerOnly,
  repoOf,
} from "./poll-helpers.js";

vi.mock("../flow/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../flow/index.js")>()),
  parseHarnessConfig: vi.fn(),
}));
vi.mock("../ledger/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ledger/index.js")>()),
  pollSignals: vi.fn(),
}));

const ROOT = "/repo";
const CONFIG_PATH = join(ROOT, HARNESS_CONFIG);

/** A parsed harness config: the default cost, and the owner login when one is named. */
function configWith(login?: string) {
  return {
    cost: DEFAULT_COST,
    ...(login === undefined ? {} : { ownerLogin: login }),
  };
}

/** The fakes a poll reads: a root, a config file system, a runner and a clock. */
function fakes(config: { exists: boolean; text?: string } = { exists: false }) {
  return {
    root: vi.fn(() => Promise.resolve(ROOT)),
    fs: {
      exists: vi.fn(() => Promise.resolve(config.exists)),
      readFile: vi.fn(() => Promise.resolve(config.text ?? "")),
    },
    runner: { run: vi.fn() },
    clock: { now: vi.fn(), sleep: vi.fn() },
  };
}

beforeEach(() => {
  vi.mocked(parseHarnessConfig).mockReturnValue(configWith());
});

describe("ownerLogin", () => {
  it("returns the login the harness config names", async () => {
    const f = fakes({ exists: true, text: "{}" });
    vi.mocked(parseHarnessConfig).mockReturnValue(configWith("junners"));
    expect(await ownerLogin(contextWith(f), "acme/app")).toBe("junners");
    expect(parseHarnessConfig).toHaveBeenCalledWith("{}", HARNESS_CONFIG);
  });

  it("reads the config from the root's harness config path", async () => {
    const f = fakes({ exists: true, text: "{}" });
    await ownerLogin(contextWith(f), "acme/app");
    expect(f.fs.exists).toHaveBeenCalledWith(CONFIG_PATH);
    expect(f.fs.readFile).toHaveBeenCalledWith(CONFIG_PATH);
  });

  it("falls back to the repository's owner when the config names no login", async () => {
    const f = fakes({ exists: true, text: "{}" });
    expect(await ownerLogin(contextWith(f), "acme/app")).toBe("acme");
  });

  it("falls back to the repository's owner, without parsing, when there is no config file", async () => {
    const f = fakes({ exists: false });
    expect(await ownerLogin(contextWith(f), "acme/app")).toBe("acme");
    expect(f.fs.readFile).not.toHaveBeenCalled();
    expect(parseHarnessConfig).not.toHaveBeenCalled();
  });

  it("returns the config error unchanged, so the poll names the bad file", async () => {
    const f = fakes({ exists: true, text: "{}" });
    vi.mocked(parseHarnessConfig).mockReturnValue({ error: "bad ownerLogin" });
    expect(await ownerLogin(contextWith(f), "acme/app")).toEqual({
      error: "bad ownerLogin",
    });
  });

  it("falls back to the repository's owner when the root cannot be found, reading nothing", async () => {
    const f = fakes({ exists: true, text: "{}" });
    f.root.mockRejectedValue(new Error("no root"));
    expect(await ownerLogin(contextWith(f), "acme/app")).toBe("acme");
    expect(f.fs.exists).not.toHaveBeenCalled();
  });
});

describe("pollOutcomeSignals", () => {
  const polled = { ok: true as const, recorded: 1, events: [] };

  it("polls the signals for the resolved owner and returns the poll's result", async () => {
    const f = fakes({ exists: true, text: "{}" });
    vi.mocked(parseHarnessConfig).mockReturnValue(configWith("junners"));
    const { ledger } = fakeLedger();
    vi.mocked(pollSignals).mockResolvedValue(polled);
    const result = await pollOutcomeSignals(contextWith(f), ledger, "acme/app");
    expect(result).toBe(polled);
    expect(pollSignals).toHaveBeenCalledWith({
      ledger,
      runner: f.runner,
      clock: f.clock,
      fs: f.fs,
      repo: "acme/app",
      owner: "junners",
    });
  });

  it("passes --since to the signals when the command was given one", async () => {
    const f = fakes();
    const { ledger } = fakeLedger();
    vi.mocked(pollSignals).mockResolvedValue(polled);
    await pollOutcomeSignals(
      contextWith(f, { since: "2026-01-05T00:00:00Z" }),
      ledger,
      "acme/app",
    );
    expect(pollSignals).toHaveBeenCalledWith(
      expect.objectContaining({ since: "2026-01-05T00:00:00Z", owner: "acme" }),
    );
  });

  it("tags a failed signal poll as a github failure, keeping its message", async () => {
    const f = fakes();
    const { ledger } = fakeLedger();
    vi.mocked(pollSignals).mockResolvedValue({ ok: false, message: "gh down" });
    expect(
      await pollOutcomeSignals(contextWith(f), ledger, "acme/app"),
    ).toEqual({ ok: false, message: "gh down", field: "github" });
  });

  it("refuses an unreadable config as a config failure, without polling", async () => {
    const f = fakes({ exists: true, text: "{}" });
    vi.mocked(parseHarnessConfig).mockReturnValue({ error: "bad ownerLogin" });
    const { ledger } = fakeLedger();
    expect(
      await pollOutcomeSignals(contextWith(f), ledger, "acme/app"),
    ).toEqual({ ok: false, message: "bad ownerLogin", field: "config" });
    expect(pollSignals).not.toHaveBeenCalled();
  });
});

describe("pollerOnly", () => {
  const MESSAGE = `Events from source github, and kinds ${POLLER_KINDS.join(", ")}, are not recordable by hand: only \`ledger poll-github\` writes them, from GitHub's own records.`;

  it("refuses any event from the github source", () => {
    expect(pollerOnly({ source: "github", kind: "tool.start" })).toBe(MESSAGE);
  });

  it("refuses a poller-only kind from any other source", () => {
    expect(pollerOnly({ source: "claude", kind: "pr.merged" })).toBe(MESSAGE);
  });

  it("allows an ordinary event from an agent source", () => {
    expect(pollerOnly({ source: "claude", kind: "session.start" })).toBe(
      undefined,
    );
  });

  it("allows input that is not an object, leaving the schema to reject it", () => {
    expect(pollerOnly(undefined)).toBe(undefined);
    expect(pollerOnly(null)).toBe(undefined);
  });
});

describe("repoOf", () => {
  it("defaults to the kore repository when no --repo is given", () => {
    expect(repoOf({})).toBe("corekraft/kore");
    expect(DEFAULT_REPO).toBe("corekraft/kore");
  });

  it("returns an owner/name value unchanged", () => {
    expect(repoOf({ repo: "acme/app.v2" })).toBe("acme/app.v2");
  });

  it.each(["nope", "a/b/c", "a/ b"])(
    "refuses %j with a message that shows the expected owner/name form",
    (value) => {
      expect(repoOf({ repo: value })).toEqual({
        error: `Invalid --repo "${value}". Use owner/name, such as corekraft/kore.`,
      });
    },
  );
});
