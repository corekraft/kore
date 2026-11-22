import { beforeEach, describe, expect, it, vi } from "vitest";
import { bundleMainRoot } from "../runtime/index.js";
import { contextOf, fakeDeps, type FakeDeps } from "./deps-support.js";
import { execCommand, launchClaude } from "./exec.js";
import {
  ARGV,
  BUNDLE_URL,
  HELP,
  INPUT,
  INHERITED,
  MAIN,
  MINTED,
  SCRUBBED,
  WORKTREE_BUNDLE_URL,
  answer,
  claudeRuns,
  defaults,
  flags,
  from,
  printed,
  signer,
  type Signer,
} from "./exec-support.js";

// The token path runs for real; only the JWT signing is stubbed.
const crypto = vi.hoisted(() => ({
  createSign: vi.fn<(algorithm: string) => Signer>(),
}));

vi.mock("node:crypto", () => crypto);
vi.mock("../runtime/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../runtime/index.js")>()),
  bundleMainRoot: vi.fn(),
}));
vi.mock("../flag/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../flag/index.js")>()),
  environments: vi.fn(),
  readOverlay: vi.fn(),
}));

const HELP_WITHOUT_EFFORT = HELP.replace(
  "  --effort <level>  Effort level\n",
  "",
);
const HELP_WITHOUT_SETTINGS = HELP.replace(
  "  --settings <file>  Settings file",
  "",
);

let deps: FakeDeps;

beforeEach(() => {
  vi.clearAllMocks();
  deps = fakeDeps();
  defaults(deps);
  vi.mocked(bundleMainRoot).mockResolvedValue(MAIN);
  crypto.createSign.mockReturnValue(signer());
  flags({ "role-tokens": true, "owner-writer": false });
  answer(deps);
});

describe("launchClaude: where it may run from", () => {
  it("refuses a bundle outside the main checkout, and starts neither claude nor a token read", async () => {
    const code = await launchClaude(from(deps, WORKTREE_BUNDLE_URL), INPUT);

    expect(code).toBe(1);
    expect(deps.stderr).toHaveBeenCalledWith(
      "session exec refuses to run from the bundle at /repo/.claude/worktrees/w, which is not the main checkout /repo. Start it by absolute path from the main checkout's skills/bin/harness.mjs, then rerun.\n",
    );
    expect(deps.runner.run).not.toHaveBeenCalled();
  });

  it("refuses when the bundle or the main checkout cannot be found", async () => {
    vi.mocked(bundleMainRoot).mockResolvedValue(undefined);

    const code = await launchClaude(from(deps, BUNDLE_URL), INPUT);

    expect(code).toBe(1);
    expect(deps.stderr).toHaveBeenCalledWith(
      "session exec cannot find the main checkout's bundle. Start it by absolute path from the main checkout's skills/bin/harness.mjs, then rerun.\n",
    );
    expect(deps.runner.run).not.toHaveBeenCalled();
  });
});

describe("launchClaude: the flags claude must have", () => {
  it("refuses to start when claude --help lacks a flag the wrapper passes, naming it and reading no token", async () => {
    answer(deps, {
      help: { stdout: HELP_WITHOUT_EFFORT, stderr: "", code: 0 },
    });

    const code = await launchClaude(from(deps, BUNDLE_URL), INPUT);

    expect(code).toBe(1);
    expect(deps.stderr).toHaveBeenCalledWith(
      "The installed claude lacks --effort, which session exec passes. Upgrade claude, then rerun.\n",
    );
    expect(deps.runner.run.mock.calls.map(([command]) => command)).toEqual([
      "claude",
    ]);
  });

  it("refuses a claude whose --help has --setting-sources but no --settings, since one is not the other", async () => {
    answer(deps, {
      help: { stdout: HELP_WITHOUT_SETTINGS, stderr: "", code: 0 },
    });

    const code = await launchClaude(from(deps, BUNDLE_URL), INPUT);

    expect(code).toBe(1);
    expect(deps.stderr).toHaveBeenCalledWith(
      "The installed claude lacks --settings, which session exec passes. Upgrade claude, then rerun.\n",
    );
  });

  it("refuses when claude --help cannot run, and says so", async () => {
    answer(deps, { help: { stdout: "", stderr: "", code: 127 } });

    const code = await launchClaude(from(deps, BUNDLE_URL), INPUT);

    expect(code).toBe(1);
    expect(deps.stderr).toHaveBeenCalledWith(
      "Could not run `claude --help`, so session exec cannot check claude's flags. Install claude, then rerun.\n",
    );
    expect(claudeRuns(deps)).toEqual([]);
  });
});

describe("launchClaude: the argv and the exit code", () => {
  it("passes claude the fixed argv, with the brief as the positional prompt last", async () => {
    await launchClaude(from(deps, BUNDLE_URL), INPUT);

    expect(claudeRuns(deps)).toEqual([
      ["claude", ARGV, expect.objectContaining({ inherit: true })],
    ]);
  });

  it("returns claude's exit code and prints nothing of its own on a clean exit", async () => {
    answer(deps, { claude: { stdout: "", stderr: "", code: 3 } });

    const code = await launchClaude(from(deps, BUNDLE_URL), INPUT);

    expect(code).toBe(3);
    expect(deps.stdout).not.toHaveBeenCalled();
    expect(deps.stderr).not.toHaveBeenCalled();
  });

  it("never prints the minted or the inherited token", async () => {
    deps.env = { ...SCRUBBED, GH_TOKEN: INHERITED, GITHUB_TOKEN: INHERITED };
    answer(deps, { claude: { stdout: "", stderr: "boom", code: 1 } });

    await launchClaude(from(deps, BUNDLE_URL), INPUT);

    expect(printed(deps)).not.toContain(MINTED);
    expect(printed(deps)).not.toContain(INHERITED);
  });
});

describe("execCommand: its operands", () => {
  it("refuses a call missing a role, a model, an effort or the brief, and starts nothing", async () => {
    const code = await execCommand.run(
      contextOf(deps, {
        options: { role: "writer", model: "m" },
        operand: undefined,
      }),
    );

    expect(code).toBe(1);
    expect(deps.stderr).toHaveBeenCalledWith(
      "session exec needs --role, --model and --effort, and one brief operand. Rerun with all of them.\n",
    );
    expect(deps.runner.run).not.toHaveBeenCalled();
  });
});
