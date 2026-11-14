import { dirname, join, resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CommandError,
  mainRoot,
  type CliDeps,
  type RunResult,
  type Runner,
} from "../runtime/index.js";
import { describeFailure } from "./equalize.js";
import {
  HANDOFF_TIMEOUT_MS,
  handOff,
  handoffDir,
  unreadTokenHint,
} from "./handoff.js";

vi.mock("node:path");
vi.mock("./equalize.js");
vi.mock("../runtime/index.js", async (original) => ({
  ...(await original<typeof import("../runtime/index.js")>()),
  mainRoot: vi.fn(),
}));

const TOKEN = "ghs_handoff_secret_value";
const DIR = "/main/.kore/state/handoff/w1";
const FIFO = `${DIR}/token`;
const PANE = "w3:p9";
const WRITE = ["-c", 'exec cat > "$1"', "sh", FIFO];
const DRAIN = ["-c", 'exec cat < "$1" > /dev/null', "sh", FIFO];
const READ_TOKEN = String.raw`export GH_TOKEN="$(cat '${FIFO}')"; [ -n "$GH_TOKEN" ] || exit 1`;

type Answer = (
  command: string,
  args: readonly string[],
) => Partial<RunResult> | undefined;

/**
 * Deps whose runner is a typed mock: `answer` overrides a call's result, and
 * every other call succeeds. Each call is recorded for the assertions.
 */
function deps(answer: Answer = () => undefined) {
  const run = vi.fn<Runner["run"]>((command, args) =>
    Promise.resolve({
      stdout: "",
      stderr: "",
      code: 0,
      ...answer(command, args),
    }),
  );
  // Only what the handoff touches; the rest of CliDeps is never read.
  return { deps: { runner: { run } } as unknown as CliDeps, run };
}

beforeEach(() => {
  vi.mocked(join).mockImplementation((...parts) => parts.join("/"));
  vi.mocked(dirname).mockImplementation((path) =>
    path.slice(0, path.lastIndexOf("/")),
  );
  vi.mocked(resolve).mockImplementation((...parts) => parts.join("/"));
  vi.mocked(mainRoot).mockResolvedValue("/main");
  vi.mocked(describeFailure).mockImplementation((result) => result.stderr);
});

describe("handoffDir places the handoff under the main checkout", () => {
  it("names the directory for the session under the main checkout's runtime state", async () => {
    const d = deps();
    expect(await handoffDir(d.deps, "image-trust-writer")).toBe(
      "/main/.kore/state/handoff/image-trust-writer",
    );
    expect(mainRoot).toHaveBeenCalledWith(d.deps);
  });

  it("refuses with a fix when no main checkout can be found", async () => {
    vi.mocked(mainRoot).mockResolvedValue(undefined);
    await expect(handoffDir(deps().deps, "w1")).rejects.toThrow(CommandError);
    await expect(handoffDir(deps().deps, "w1")).rejects.toThrow(
      "Cannot find the main checkout to hand a token over in. Run inside the repository or set KORE_ROOT to its root.",
    );
  });
});

describe("handOff delivers the token through a fresh FIFO", () => {
  it("makes the directory and FIFO, writes the token to the FIFO, tells the pane, and removes the directory", async () => {
    const d = deps();
    expect(
      await handOff(d.deps, {
        dir: DIR,
        pane: PANE,
        token: TOKEN,
        timeoutMs: 5000,
      }),
    ).toBeUndefined();
    expect(d.run.mock.calls).toEqual([
      ["rm", ["-rf", DIR]],
      ["mkdir", ["-p", "/main/.kore/state/handoff"]],
      ["mkdir", ["-m", "700", DIR]],
      ["mkfifo", ["-m", "600", FIFO]],
      ["sh", WRITE, { input: TOKEN, timeoutMs: 5000 }],
      ["herdr", ["pane", "run", PANE, READ_TOKEN]],
      ["rm", ["-rf", DIR]],
    ]);
  });

  it("keeps the token out of every argument list, sending it on stdin only", async () => {
    const d = deps();
    await handOff(d.deps, {
      dir: DIR,
      pane: PANE,
      token: TOKEN,
      timeoutMs: 5000,
    });
    const argv = d.run.mock.calls.flatMap(([, args]) => [...args]);
    expect(argv).not.toContain(TOKEN);
    expect(argv.join(" ")).not.toContain(TOKEN);
  });

  it("quotes a FIFO path with an apostrophe so the pane's shell reads the right file", async () => {
    const quoted = "/main/.kore/state/handoff/it's";
    const d = deps();
    await handOff(d.deps, {
      dir: quoted,
      pane: PANE,
      token: TOKEN,
      timeoutMs: 5000,
    });
    expect(d.run.mock.calls[5]).toEqual([
      "herdr",
      [
        "pane",
        "run",
        PANE,
        String.raw`export GH_TOKEN="$(cat '/main/.kore/state/handoff/it'\''s/token')"; [ -n "$GH_TOKEN" ] || exit 1`,
      ],
    ]);
  });
});

describe("handOff reports each step that fails, and still removes the directory", () => {
  it("names the command that failed and stops before the FIFO when the directory cannot be made", async () => {
    const d = deps((command, args) =>
      command === "mkdir" && args[0] === "-m"
        ? { code: 1, stderr: "File exists" }
        : undefined,
    );
    expect(
      await handOff(d.deps, {
        dir: DIR,
        pane: PANE,
        token: TOKEN,
        timeoutMs: 5000,
      }),
    ).toBe("mkdir -m 700 /main/.kore/state/handoff/w1 failed: File exists");
    expect(d.run.mock.calls.map(([command]) => command)).toEqual([
      "rm",
      "mkdir",
      "mkdir",
      "rm",
    ]);
  });

  it("drains the FIFO and names herdr's error when herdr cannot tell the pane where to read", async () => {
    const d = deps((command) =>
      command === "herdr" ? { code: 1, stderr: "no such pane" } : undefined,
    );
    expect(
      await handOff(d.deps, {
        dir: DIR,
        pane: PANE,
        token: TOKEN,
        timeoutMs: 5000,
      }),
    ).toBe(
      "herdr pane run failed to tell w3:p9 where to read its token: no such pane",
    );
    expect(d.run.mock.calls.slice(-3)).toEqual([
      ["herdr", ["pane", "run", PANE, READ_TOKEN]],
      ["sh", DRAIN, { timeoutMs: 2000 }],
      ["rm", ["-rf", DIR]],
    ]);
  });

  it("names the timeout when the pane did not read the FIFO in time", async () => {
    const d = deps((command, args) =>
      command === "sh" && args[1] === WRITE[1]
        ? { code: 1, stderr: "killed" }
        : undefined,
    );
    expect(
      await handOff(d.deps, {
        dir: DIR,
        pane: PANE,
        token: TOKEN,
        timeoutMs: HANDOFF_TIMEOUT_MS,
      }),
    ).toBe(
      "The pane w3:p9 did not read its token within 10000 ms (killed). Close it with `herdr pane close w3:p9`, then spawn again.",
    );
  });
});

describe("unreadTokenHint explains a pane whose shell exited without a token", () => {
  it("adds the empty-read explanation to a failed agent start", () => {
    expect(
      unreadTokenHint("herdr agent start failed after 10 tries: boom"),
    ).toBe(
      "herdr agent start failed after 10 tries: boom If the pane's shell exited, it read no token (another process may have read the FIFO first); spawn again.",
    );
  });

  it("passes any other error through unchanged", () => {
    expect(unreadTokenHint("pane not found")).toBe("pane not found");
  });
});
