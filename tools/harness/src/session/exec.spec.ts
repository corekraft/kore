import { beforeEach, describe, expect, it, vi } from "vitest";
import { bundleMainRoot, type CliDeps } from "../runtime/index.js";
import { contextOf, fakeDeps, type FakeDeps } from "./deps-support.js";
import { execCommand, launchClaude } from "./exec.js";
import { roleToken } from "./role-token.js";

vi.mock("../runtime/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../runtime/index.js")>()),
  bundleMainRoot: vi.fn(),
}));
vi.mock("./role-token.js", () => ({ roleToken: vi.fn() }));

const MAIN = "/repo";
const BUNDLE_URL = "file:///repo/skills/bin/harness.mjs";
const WORKTREE_BUNDLE_URL =
  "file:///repo/.claude/worktrees/w/skills/bin/harness.mjs";
const INPUT = {
  role: "writer",
  model: "claude-opus-5-5",
  effort: "high",
  brief: "Fix the bug.\nThen report.",
};
const ARGV = [
  "--agent",
  "writer",
  "--model",
  "claude-opus-5-5",
  "--effort",
  "high",
  "--permission-mode",
  "bypassPermissions",
  "--setting-sources",
  "user",
  "--settings",
  "/repo/.claude/settings.json",
  "Fix the bug.\nThen report.",
];
/** claude --help as the installed claude prints it, with every flag the wrapper passes. */
const HELP = [
  "  --agent <agent>  Agent for the session",
  "  --model <model>  Model for the session",
  "  --effort <level>  Effort level",
  "  --permission-mode <mode>  Permission mode",
  "  --setting-sources <sources>  Setting sources",
  "  --settings <file>  Settings file",
].join("\n");

let deps: FakeDeps;

/** Answers claude --help, and the claude run, from the spec's own values. */
function answer(reply: {
  help?: string;
  helpCode?: number;
  claudeCode?: number;
  claudeStderr?: string;
}): void {
  deps.runner.run.mockImplementation((_command, args) =>
    Promise.resolve(
      args[0] === "--help"
        ? { stdout: reply.help ?? HELP, stderr: "", code: reply.helpCode ?? 0 }
        : {
            stdout: "",
            stderr: reply.claudeStderr ?? "",
            code: reply.claudeCode ?? 0,
          },
    ),
  );
}

/** The deps a wrapper started from the given bundle address sees. */
const from = (bundleUrl: string | undefined): CliDeps =>
  bundleUrl === undefined ? deps : { ...deps, bundleUrl };

/** The claude run the spec recorded, if the wrapper started it. */
function claudeRuns(): unknown[][] {
  return deps.runner.run.mock.calls.filter(([, args]) => args[0] !== "--help");
}

beforeEach(() => {
  vi.clearAllMocks();
  deps = fakeDeps();
  vi.mocked(bundleMainRoot).mockResolvedValue(MAIN);
  vi.mocked(roleToken).mockResolvedValue({ token: "ghs_minted" });
  answer({});
});

describe("launchClaude: where it may run from", () => {
  it("refuses a bundle outside the main checkout, and starts neither claude nor a token mint", async () => {
    const code = await launchClaude(from(WORKTREE_BUNDLE_URL), INPUT);

    expect(code).toBe(1);
    expect(deps.stderr).toHaveBeenCalledWith(
      "session exec refuses to run from the bundle at /repo/.claude/worktrees/w, which is not the main checkout /repo. Start it by absolute path from the main checkout's skills/bin/harness.mjs, then rerun.\n",
    );
    expect(deps.runner.run).not.toHaveBeenCalled();
    expect(roleToken).not.toHaveBeenCalled();
  });

  it("refuses when the bundle or the main checkout cannot be found", async () => {
    vi.mocked(bundleMainRoot).mockResolvedValue(undefined);

    const code = await launchClaude(from(BUNDLE_URL), INPUT);

    expect(code).toBe(1);
    expect(deps.stderr).toHaveBeenCalledWith(
      "session exec cannot find the main checkout's bundle. Start it by absolute path from the main checkout's skills/bin/harness.mjs, then rerun.\n",
    );
    expect(deps.runner.run).not.toHaveBeenCalled();
  });
});

describe("launchClaude: the flags claude must have", () => {
  it("refuses to start when claude --help lacks a flag the wrapper passes, naming it and minting nothing", async () => {
    answer({ help: HELP.replace("  --effort <level>  Effort level\n", "") });

    const code = await launchClaude(from(BUNDLE_URL), INPUT);

    expect(code).toBe(1);
    expect(deps.stderr).toHaveBeenCalledWith(
      "The installed claude lacks --effort, which session exec passes. Upgrade claude, then rerun.\n",
    );
    expect(roleToken).not.toHaveBeenCalled();
    expect(claudeRuns()).toEqual([]);
  });

  it("refuses a claude whose --help has --setting-sources but no --settings, since one is not the other", async () => {
    answer({ help: HELP.replace("  --settings <file>  Settings file", "") });

    const code = await launchClaude(from(BUNDLE_URL), INPUT);

    expect(code).toBe(1);
    expect(deps.stderr).toHaveBeenCalledWith(
      "The installed claude lacks --settings, which session exec passes. Upgrade claude, then rerun.\n",
    );
  });

  it("refuses when claude --help cannot run, and says so", async () => {
    answer({ helpCode: 127 });

    const code = await launchClaude(from(BUNDLE_URL), INPUT);

    expect(code).toBe(1);
    expect(deps.stderr).toHaveBeenCalledWith(
      "Could not run `claude --help`, so session exec cannot check claude's flags. Install claude, then rerun.\n",
    );
    expect(claudeRuns()).toEqual([]);
  });
});

describe("launchClaude: the environment claude gets", () => {
  it("runs claude with the role's minted token, the main bundle, and no inherited GitHub token or herdr variable", async () => {
    deps.env = {
      HOME: "/home/agent",
      HC_TERMINAL_ID: "t7",
      GH_TOKEN: "inherited-gh",
      GITHUB_TOKEN: "inherited-github",
      HERDR_ENV: "1",
      HERDR_PANE_ID: "w1-p2",
    };

    const code = await launchClaude(from(BUNDLE_URL), INPUT);

    expect(code).toBe(0);
    expect(deps.runner.run).toHaveBeenCalledWith("claude", ARGV, {
      env: {
        HOME: "/home/agent",
        HC_TERMINAL_ID: "t7",
        GH_TOKEN: "ghs_minted",
        KORE_HARNESS_BUNDLE: "/repo/skills/bin/harness.mjs",
      },
      inherit: true,
    });
  });

  it("mints the token from the main checkout's flags and identity, not the worktree's", async () => {
    await launchClaude(from(BUNDLE_URL), INPUT);

    const [seen, role] = vi.mocked(roleToken).mock.calls[0] ?? [];
    expect(role).toBe("writer");
    expect(await seen?.root()).toBe(MAIN);
  });

  it("runs a role with no identity of its own with no GitHub token, still scrubbing the inherited ones", async () => {
    vi.mocked(roleToken).mockResolvedValue(undefined);
    deps.env = { GH_TOKEN: "inherited-gh", GITHUB_TOKEN: "inherited-github" };

    const code = await launchClaude(from(BUNDLE_URL), {
      ...INPUT,
      role: "reader",
    });

    expect(code).toBe(0);
    expect(deps.runner.run).toHaveBeenCalledWith(
      "claude",
      ARGV.map((arg, index) => (index === 1 ? "reader" : arg)),
      {
        env: { KORE_HARNESS_BUNDLE: "/repo/skills/bin/harness.mjs" },
        inherit: true,
      },
    );
  });
});

describe("launchClaude: a token that cannot be made", () => {
  it.each([
    [
      "a missing store item",
      "The writer identity is missing: keychain item kore.writer.app-id was not found. Create it with `bash tools/harness/wizards/identities.sh`, then rerun.",
    ],
    [
      "an undecryptable store",
      "The writer identity is missing: item kore.writer.private-key could not be read from /home/agent/.config/kore/identities.sops.json (it is absent, or sops could not decrypt it with the age key /home/agent/.config/sops/age/keys.txt). From the Mac, run `bash tools/harness/wizards/identities.sh --transfer <user@host>`, then rerun.",
    ],
    [
      "a failed mint",
      "Could not mint a kore-writer installation token (the response carried no token). Check the App is installed on corekraft/kore and its key is current: `bash tools/harness/wizards/identities.sh`, then rerun.",
    ],
  ])(
    "refuses with the reason for %s, and never starts claude",
    async (_name, reason) => {
      vi.mocked(roleToken).mockResolvedValue({
        error: `${reason} No pane was split.`,
      });

      const code = await launchClaude(from(BUNDLE_URL), INPUT);

      expect(code).toBe(1);
      expect(deps.stderr).toHaveBeenCalledWith(`${reason}\n`);
      expect(claudeRuns()).toEqual([]);
    },
  );
});

describe("launchClaude: the argv and the exit code", () => {
  it("passes claude the fixed argv, with the brief as the positional prompt last", async () => {
    await launchClaude(from(BUNDLE_URL), INPUT);

    expect(claudeRuns()).toEqual([
      ["claude", ARGV, expect.objectContaining({ inherit: true })],
    ]);
  });

  it("returns claude's exit code and prints nothing of its own on a clean exit", async () => {
    answer({ claudeCode: 3 });

    const code = await launchClaude(from(BUNDLE_URL), INPUT);

    expect(code).toBe(3);
    expect(deps.stdout).not.toHaveBeenCalled();
    expect(deps.stderr).not.toHaveBeenCalled();
  });

  it("never prints the minted token, on success or failure", async () => {
    answer({ claudeCode: 1, claudeStderr: "boom" });

    await launchClaude(from(BUNDLE_URL), INPUT);

    const printed = [
      ...vi.mocked(deps.stdout).mock.calls,
      ...vi.mocked(deps.stderr).mock.calls,
    ].join("");
    expect(printed).not.toContain("ghs_minted");
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
