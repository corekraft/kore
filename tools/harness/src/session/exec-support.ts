// Fixtures the exec specs share: values, and the runner's answers to the commands the wrapper runs.
// The specs mock the process-level modules themselves (crypto, the flag overlay, the bundle root).
import { vi } from "vitest";
import { environments, readOverlay } from "../flag/index.js";
import type { CliDeps, RunResult } from "../runtime/index.js";
import type { FakeDeps } from "./deps-support.js";

export const MAIN = "/repo";
export const HOME = "/home/agent";
export const STORE = `${HOME}/.config/kore/identities.sops.json`;
export const AGE_KEY = `${HOME}/.config/sops/age/keys.txt`;
export const WIZARD = "tools/harness/wizards/identities.sh";
export const BUNDLE_URL = "file:///repo/skills/bin/harness.mjs";
export const WORKTREE_BUNDLE_URL =
  "file:///repo/.claude/worktrees/w/skills/bin/harness.mjs";
const PEM = "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n";
export const STORE_ITEMS: Record<string, string> = {
  "kore.writer.app-id": "12345",
  "kore.writer.installation-id": "678",
  "kore.writer.private-key": Buffer.from(PEM).toString("base64"),
};
/** The token a mint returns; it must reach claude and never a printed line. */
export const MINTED = "ghs_minted_writer";
/** The GitHub token the core's login environment hands the wrapper; it must never reach claude. */
export const INHERITED = "ghs_inherited_sentinel";
export const OWNER = "gho_owner_token";
export const INPUT = {
  role: "writer",
  model: "claude-opus-5-5",
  effort: "high",
  brief: "Fix the bug.\nThen report.",
};
/** The agent definition each role's --agents value carries, as exec-agent builds it from the main checkout. */
export const AGENT_JSON: Record<string, string> = {
  writer:
    '{"writer":{"description":"Changes files.","prompt":"You change files.","tools":["Bash","Edit"],"model":"claude-haiku-5-5","effort":"medium"}}',
  reader:
    '{"reader":{"description":"Reads files.","prompt":"You read files.","model":"claude-haiku-5-5","effort":"low"}}',
};
/** The definition file each role has under the main checkout's .claude/agents. */
export const DEFINITIONS: Record<string, string> = {
  writer: `---
name: writer
description: Changes files.
model: claude-haiku-5-5
effort: medium
tools: Bash, Edit
---

You change files.
`,
  reader: `---
name: reader
description: Reads files.
model: claude-haiku-5-5
effort: low
---

You read files.
`,
};
/** The argv session exec passes for a role, with the writer's launch settings. */
export const argvFor = (role: string): string[] => [
  "--agent",
  role,
  "--agents",
  AGENT_JSON[role] ?? "",
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
export const ARGV = [
  "--agent",
  "writer",
  "--agents",
  AGENT_JSON.writer ?? "",
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
/** What `claude --version` prints for the claude the wrapper's minimum names. */
export const VERSION = "2.1.330 (Claude Code)\n";
/** claude --help as the installed claude prints it, with every flag the wrapper passes. */
export const HELP = [
  "  --agent <agent>  Agent for the session",
  "  --agents <json-or-file>  Agent definitions",
  "  --model <model>  Model for the session",
  "  --effort <level>  Effort level",
  "  --permission-mode <mode>  Permission mode",
  "  --setting-sources <sources>  Setting sources",
  "  --settings <file>  Settings file",
].join("\n");
/** The environment every call of the token path runs with: the caller's, scrubbed. */
export const SCRUBBED = { HOME, HC_TERMINAL_ID: "t7" };

export interface Replies {
  help?: RunResult;
  version?: RunResult;
  claude?: RunResult;
  sops?: RunResult;
  curl?: RunResult;
  gh?: RunResult;
}

export interface Signer {
  update(data: string): Signer;
  sign(key: string): Buffer;
}

export function signer(): Signer {
  const self: Signer = {
    update: () => self,
    sign: () => Buffer.from("signed"),
  };
  return self;
}

/** The flag overlay for the local environment, given the features it turns on or off. */
export function flags(features: Record<string, boolean>): void {
  vi.mocked(environments).mockResolvedValue(["local"]);
  vi.mocked(readOverlay).mockResolvedValue({
    environment: "local",
    path: "infra/environments/local/environment.yaml",
    text: "",
    features,
  });
}

/** claude's answer to one call: the --help and --version probes, or the replies' claude result for a run. */
function claudeAnswer(args: readonly string[], replies: Replies): RunResult {
  if (args[0] === "--help") {
    return replies.help ?? { stdout: HELP, stderr: "", code: 0 };
  }
  if (args[0] === "--version") {
    return replies.version ?? { stdout: VERSION, stderr: "", code: 0 };
  }
  return replies.claude ?? { stdout: "", stderr: "", code: 0 };
}

/** Answers each command from the spec's replies: claude, sops (from the store items), curl and gh. */
export function answer(deps: FakeDeps, replies: Replies = {}): void {
  deps.runner.run.mockImplementation((command, args) => {
    if (command === "claude") {
      return Promise.resolve(claudeAnswer(args, replies));
    }
    if (command === "curl") {
      return Promise.resolve(
        replies.curl ?? {
          stdout: `{"token":"${MINTED}"}`,
          stderr: "",
          code: 0,
        },
      );
    }
    if (command === "gh") {
      return Promise.resolve(
        replies.gh ?? { stdout: `${OWNER}\n`, stderr: "", code: 0 },
      );
    }
    if (command === "sops") {
      const extract = args[args.indexOf("--extract") + 1] ?? "[]";
      const item = (JSON.parse(extract) as string[])[0] ?? "";
      const value = STORE_ITEMS[item];
      return Promise.resolve(
        replies.sops ??
          (value === undefined
            ? { stdout: "", stderr: "", code: 1 }
            : { stdout: `${value}\n`, stderr: "", code: 0 }),
      );
    }
    return Promise.resolve({
      stdout: "",
      stderr: `unexpected ${command}`,
      code: 127,
    });
  });
}

/** Deps a wrapper started from the bundle address sees; without one, the bundle is unknown. */
export const from = (deps: FakeDeps, bundleUrl?: string): CliDeps =>
  bundleUrl === undefined ? deps : { ...deps, bundleUrl };

/** The claude runs recorded, not the --help and --version probes. */
export function claudeRuns(deps: FakeDeps): unknown[][] {
  return deps.runner.run.mock.calls.filter(
    ([command, args]) =>
      command === "claude" && args[0] !== "--help" && args[0] !== "--version",
  );
}

/** Everything the wrapper printed to stdout or stderr. */
export const printed = (deps: FakeDeps): string =>
  [...deps.stdout.mock.calls, ...deps.stderr.mock.calls].flat().join("");

/** Platform, environment and store defaults every spec starts from: a Linux host with its store present. */
export function defaults(deps: FakeDeps): void {
  deps.platform = "linux";
  deps.env = { ...SCRUBBED };
  deps.fs.exists.mockResolvedValue(true);
  deps.fs.readFile.mockImplementation((path) => {
    const role = Object.keys(DEFINITIONS).find(
      (name) => path === `${MAIN}/.claude/agents/${name}.md`,
    );
    return role === undefined
      ? Promise.reject(Object.assign(new Error(path), { code: "ENOENT" }))
      : Promise.resolve(DEFINITIONS[role] ?? "");
  });
}
