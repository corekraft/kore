import { beforeEach, describe, expect, it, vi } from "vitest";
import { bundleMainRoot } from "../runtime/index.js";
import { contextOf, fakeDeps, type FakeDeps } from "./deps-support.js";
import { execCommand, launchClaude } from "./exec.js";
import {
  AGENT_JSON,
  ARGV,
  argvFor,
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
const HELP_WITHOUT_AGENTS = HELP.replace(
  "  --agents <json-or-file>  Agent definitions\n",
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

describe("session exec refuses an empty role before it starts claude", () => {
  it("prints the usage line, exits 1 and runs no claude", async () => {
    const code = await execCommand.run(
      contextOf(deps, {
        operand: "Do it.",
        options: { role: "", model: "claude-opus-5-5", effort: "high" },
      }),
    );

    expect(code).toBe(1);
    expect(deps.stderr).toHaveBeenCalledWith(
      "session exec needs --role, --model and --effort, and one brief operand. Rerun with all of them.\n",
    );
    expect(claudeRuns(deps)).toStrictEqual([]);
  });
});

describe("launchClaude: the role's agent definition", () => {
  it("reads the role's definition from the main checkout and passes it as --agents, with --setting-sources user kept", async () => {
    const code = await launchClaude(from(deps, BUNDLE_URL), INPUT);

    expect(code).toBe(0);
    expect(deps.fs.readFile.mock.calls).toEqual([
      ["/repo/.claude/agents/writer.md"],
    ]);
    expect(claudeRuns(deps)).toEqual([
      ["claude", ARGV, expect.objectContaining({ inherit: true })],
    ]);
  });

  it("passes a reader its own definition as its --agents value", async () => {
    await launchClaude(from(deps, BUNDLE_URL), { ...INPUT, role: "reader" });

    expect(claudeRuns(deps)).toEqual([
      ["claude", argvFor("reader"), expect.objectContaining({ inherit: true })],
    ]);
    expect(claudeRuns(deps)[0]?.[1]).toContain(AGENT_JSON.reader);
  });

  it("never reads the worktree's .claude/agents, and refuses the worktree's bundle before reading anything", async () => {
    await launchClaude(from(deps, WORKTREE_BUNDLE_URL), INPUT);

    expect(deps.fs.readFile).not.toHaveBeenCalled();
  });

  it("refuses a role with no definition under the main checkout, naming the role and the file, and starts nothing", async () => {
    const code = await launchClaude(from(deps, BUNDLE_URL), {
      ...INPUT,
      role: "ghost",
    });

    expect(code).toBe(1);
    expect(deps.stderr).toHaveBeenCalledWith(
      "The ghost role has no agent definition: /repo/.claude/agents/ghost.md was not found in the main checkout /repo. Add it there, then rerun. Nothing was started.\n",
    );
    expect(deps.runner.run).not.toHaveBeenCalled();
  });

  it("refuses a claude whose --help lacks --agents, naming it, since --agent alone does not load a definition", async () => {
    answer(deps, {
      help: { stdout: HELP_WITHOUT_AGENTS, stderr: "", code: 0 },
    });

    const code = await launchClaude(from(deps, BUNDLE_URL), INPUT);

    expect(code).toBe(1);
    expect(deps.stderr).toHaveBeenCalledWith(
      "The installed claude lacks --agents, which session exec passes. Upgrade claude, then rerun.\n",
    );
    expect(claudeRuns(deps)).toEqual([]);
  });
});

describe("launchClaude: Code Mode is off", () => {
  it("starts claude with CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=0 in its environment, overriding the 1 the caller inherits", async () => {
    deps.env = { ...SCRUBBED, CLAUDE_CODE_EXPERIMENTAL_CODE_MODE: "1" };

    const code = await launchClaude(from(deps, BUNDLE_URL), INPUT);

    expect(code).toBe(0);
    expect(claudeRuns(deps)).toEqual([
      [
        "claude",
        ARGV,
        expect.objectContaining({
          env: expect.objectContaining({
            CLAUDE_CODE_EXPERIMENTAL_CODE_MODE: "0",
          }),
        }),
      ],
    ]);
  });

  it("refuses a claude older than 2.1.330, naming the switch and the version, and starts nothing", async () => {
    answer(deps, {
      version: { stdout: "2.1.329 (Claude Code)\n", stderr: "", code: 0 },
    });

    const code = await launchClaude(from(deps, BUNDLE_URL), INPUT);

    expect(code).toBe(1);
    expect(deps.stderr).toHaveBeenCalledWith(
      "The installed claude is 2.1.329, but session exec turns Code Mode off with CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=0, which needs claude 2.1.330 or later. Upgrade claude, then rerun.\n",
    );
    expect(deps.runner.run.mock.calls.map(([command]) => command)).toEqual([
      "claude",
      "claude",
    ]);
    expect(claudeRuns(deps)).toEqual([]);
  });

  it("refuses a claude whose version cannot be read, naming the switch, and starts nothing", async () => {
    answer(deps, {
      version: { stdout: "", stderr: "unknown option", code: 1 },
    });

    const code = await launchClaude(from(deps, BUNDLE_URL), INPUT);

    expect(code).toBe(1);
    expect(deps.stderr).toHaveBeenCalledWith(
      "session exec cannot read claude's version, so it cannot check that claude turns Code Mode off with CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=0. Install claude 2.1.330 or later, then rerun.\n",
    );
    expect(claudeRuns(deps)).toEqual([]);
  });

  it("accepts a claude 2.1.1000, comparing the version's parts as numbers", async () => {
    answer(deps, {
      version: { stdout: "2.1.1000 (Claude Code)\n", stderr: "", code: 0 },
    });

    const code = await launchClaude(from(deps, BUNDLE_URL), INPUT);

    expect(code).toBe(0);
    expect(claudeRuns(deps)).toEqual([
      ["claude", ARGV, expect.objectContaining({ inherit: true })],
    ]);
  });
});
