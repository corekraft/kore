// The `session prompt-size` command (#1038): its operand, its harness config, the transcript it
// reads, and what it prints. Read-only: nothing is written. The transcript lookup, the report and
// the config parser are mocks (ADR 0098); the failures are asserted on stderr and the exit code.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_COST, parseHarnessConfig } from "../flow/index.js";
import { contextOf, fakeDeps, type FakeDeps } from "./prompt-size-support.js";
import { promptSizeCommand } from "./prompt-size-command.js";
import { promptJsonOf, promptLineOf, promptSizeOf } from "./prompt-size.js";
import { locateDefault, locateNamed } from "./prompt-size-read.js";

vi.mock("../flow/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../flow/index.js")>()),
  parseHarnessConfig: vi.fn(),
}));
vi.mock("./prompt-size-read.js", () => ({
  locateDefault: vi.fn(),
  locateNamed: vi.fn(),
}));
vi.mock("./prompt-size.js", () => ({
  promptSizeOf: vi.fn(),
  promptLineOf: vi.fn(),
  promptJsonOf: vi.fn(),
}));

const SESSION = "11111111-aaaa-4bbb-8ccc-000000000001";
const TRANSCRIPT = "the transcript text";
const CAP_TEXT = '{"compactionCap": 80000}';
const SIZE = { session: SESSION, prompt: 183_204, cap: 80_000, over: true };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(locateDefault).mockResolvedValue({
    session: SESSION,
    text: TRANSCRIPT,
  });
  vi.mocked(locateNamed).mockResolvedValue({
    session: SESSION,
    text: TRANSCRIPT,
  });
  vi.mocked(promptSizeOf).mockReturnValue(SIZE);
  vi.mocked(promptLineOf).mockReturnValue("the line\n");
  vi.mocked(promptJsonOf).mockReturnValue("the json\n");
});

/** A fake whose harness config file is present with this text, parsed to this cap. */
function withCap(deps: FakeDeps, text: string, cap: number): FakeDeps {
  deps.fs.exists.mockResolvedValue(true);
  deps.fs.readFile.mockResolvedValue(text);
  vi.mocked(parseHarnessConfig).mockReturnValue({
    cost: DEFAULT_COST,
    compactionCap: cap,
  });
  return deps;
}

describe("promptSizeCommand: what it prints", () => {
  it("prints the newest session's one text line, and exits 0", async () => {
    const deps = withCap(fakeDeps(), CAP_TEXT, 80_000);

    const code = await promptSizeCommand.run(contextOf(deps));

    expect(code).toBe(0);
    expect(locateDefault).toHaveBeenCalledExactlyOnceWith(deps, "/repo");
    expect(locateNamed).not.toHaveBeenCalled();
    expect(promptSizeOf).toHaveBeenCalledExactlyOnceWith(
      SESSION,
      TRANSCRIPT,
      80_000,
    );
    expect(promptLineOf).toHaveBeenCalledExactlyOnceWith(SIZE);
    expect(deps.stdout).toHaveBeenCalledExactlyOnceWith("the line\n");
    expect(promptJsonOf).not.toHaveBeenCalled();
  });

  it("prints the JSON form, with the same fields, under --json", async () => {
    const deps = withCap(fakeDeps(), CAP_TEXT, 80_000);

    const code = await promptSizeCommand.run(contextOf(deps, { json: true }));

    expect(code).toBe(0);
    expect(promptJsonOf).toHaveBeenCalledExactlyOnceWith(SIZE);
    expect(deps.stdout).toHaveBeenCalledExactlyOnceWith("the json\n");
    expect(promptLineOf).not.toHaveBeenCalled();
  });

  it("reads the transcript of the session it is given, not the newest", async () => {
    const deps = withCap(fakeDeps(), CAP_TEXT, 80_000);

    const code = await promptSizeCommand.run(
      contextOf(deps, { operand: SESSION }),
    );

    expect(code).toBe(0);
    expect(locateNamed).toHaveBeenCalledExactlyOnceWith(deps, "/repo", SESSION);
    expect(locateDefault).not.toHaveBeenCalled();
  });
});

describe("promptSizeCommand: operand and cap", () => {
  it("refuses a session name that is not a plain id, with a usage error, before reading any transcript", async () => {
    const deps = fakeDeps();

    const code = await promptSizeCommand.run(
      contextOf(deps, { operand: "../other/session" }),
    );

    expect(code).toBe(2);
    expect(deps.stderr).toHaveBeenCalledExactlyOnceWith(
      'Invalid session id "../other/session": give the Claude session id, letters, digits, "-" and "_" only.\n',
    );
    expect(locateNamed).not.toHaveBeenCalled();
    expect(locateDefault).not.toHaveBeenCalled();
  });

  it("prints the cap as not set and exits 0 when the config sets no cap, never under the cap", async () => {
    const deps = fakeDeps();
    deps.fs.exists.mockResolvedValue(true);
    deps.fs.readFile.mockResolvedValue("{}");
    vi.mocked(parseHarnessConfig).mockReturnValue({ cost: DEFAULT_COST });

    const code = await promptSizeCommand.run(contextOf(deps));

    expect(code).toBe(0);
    expect(promptSizeOf).toHaveBeenCalledExactlyOnceWith(
      SESSION,
      TRANSCRIPT,
      undefined,
    );
  });

  it("treats a checkout with no harness config as having no cap", async () => {
    const deps = fakeDeps();
    deps.fs.exists.mockResolvedValue(false);

    const code = await promptSizeCommand.run(contextOf(deps));

    expect(code).toBe(0);
    expect(parseHarnessConfig).not.toHaveBeenCalled();
    expect(promptSizeOf).toHaveBeenCalledExactlyOnceWith(
      SESSION,
      TRANSCRIPT,
      undefined,
    );
  });
});

describe("promptSizeCommand: failures", () => {
  it("fails with the config's own message, and reads no transcript, when the config is malformed", async () => {
    const deps = fakeDeps();
    deps.fs.exists.mockResolvedValue(true);
    deps.fs.readFile.mockResolvedValue('{"compactionCap": 0}');
    vi.mocked(parseHarnessConfig).mockReturnValue({
      error:
        'Invalid .claude/harness.json: key "compactionCap" must be a whole number of at least 1. Fix the value.',
    });

    const code = await promptSizeCommand.run(contextOf(deps));

    expect(code).toBe(1);
    expect(deps.stderr).toHaveBeenCalledExactlyOnceWith(
      'Invalid .claude/harness.json: key "compactionCap" must be a whole number of at least 1. Fix the value.\n',
    );
    expect(locateDefault).not.toHaveBeenCalled();
    expect(deps.stdout).not.toHaveBeenCalled();
  });

  it("fails with the lookup's message, and prints no size, when no transcript is found", async () => {
    const deps = withCap(fakeDeps(), CAP_TEXT, 80_000);
    vi.mocked(locateDefault).mockResolvedValue({
      error: "no transcript here.",
    });

    const code = await promptSizeCommand.run(contextOf(deps));

    expect(code).toBe(1);
    expect(deps.stderr).toHaveBeenCalledExactlyOnceWith(
      "no transcript here.\n",
    );
    expect(deps.stdout).not.toHaveBeenCalled();
    expect(promptSizeOf).not.toHaveBeenCalled();
  });

  it("fails rather than print a size of zero when the transcript holds no request yet", async () => {
    const deps = withCap(fakeDeps(), CAP_TEXT, 80_000);
    vi.mocked(promptSizeOf).mockReturnValue(undefined);

    const code = await promptSizeCommand.run(contextOf(deps));

    expect(code).toBe(1);
    expect(deps.stderr).toHaveBeenCalledExactlyOnceWith(
      `Session ${SESSION} has no request with usage yet, so its prompt size is not available. Run the command again after the session makes a request.\n`,
    );
    expect(deps.stdout).not.toHaveBeenCalled();
  });

  it("prints the failure as a JSON error line under --json, so a script can read it", async () => {
    const deps = withCap(fakeDeps(), CAP_TEXT, 80_000);
    vi.mocked(locateDefault).mockResolvedValue({
      error: "no transcript here.",
    });

    const code = await promptSizeCommand.run(contextOf(deps, { json: true }));

    expect(code).toBe(1);
    expect(deps.stderr).toHaveBeenCalledExactlyOnceWith(
      '{"error":"no transcript here."}\nno transcript here.\n',
    );
  });
});
