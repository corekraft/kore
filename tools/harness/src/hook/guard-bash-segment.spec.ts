// One Bash segment: the secret and keychain gates, then every segment rule in order. Each rule and the shell parser are mocked.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkAppendOnly } from "./guard-append-only.js";
import { checkDenyAudit } from "./guard-deny.js";
import {
  checkDenyRemovalBash,
  checkGuardrailBash,
} from "./guard-guardrails.js";
import {
  checkAgentStart,
  checkContext,
  checkDestructive,
  checkIdeaIssueBody,
  checkIdeaIssueClose,
  checkNoVerify,
} from "./guard-commands.js";
import { checkBashSegment } from "./guard-bash-segment.js";
import {
  keychainBlock,
  loadSopsPatterns,
  readsKoreKeychain,
  secretBlock,
  sopsBlock,
} from "./guard-secrets.js";
import { commandOf, isKore } from "./guard-shell.js";
import { checkRulesetSyncBash } from "./guard-ruleset.js";
import type { GuardContext, Hit } from "./guard-verdict.js";

vi.mock("./guard-append-only.js", () => ({ checkAppendOnly: vi.fn() }));
vi.mock("./guard-deny.js", () => ({ checkDenyAudit: vi.fn() }));
vi.mock("./guard-guardrails.js", () => ({
  checkDenyRemovalBash: vi.fn(),
  checkGuardrailBash: vi.fn(),
}));
vi.mock("./guard-ruleset.js", () => ({ checkRulesetSyncBash: vi.fn() }));
vi.mock("./guard-commands.js", () => ({
  checkAgentStart: vi.fn(),
  checkContext: vi.fn(),
  checkDestructive: vi.fn(),
  checkIdeaIssueBody: vi.fn(),
  checkIdeaIssueClose: vi.fn(),
  checkNoVerify: vi.fn(),
}));
// The secret constants stay real; their functions are mocked.
vi.mock("./guard-secrets.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./guard-secrets.js")>()),
  keychainBlock: vi.fn(),
  loadSopsPatterns: vi.fn(),
  readsKoreKeychain: vi.fn(),
  secretBlock: vi.fn(),
  sopsBlock: vi.fn(),
}));
vi.mock("./guard-shell.js", () => ({ commandOf: vi.fn(), isKore: vi.fn() }));

// The command name the segment is given as data: each rule is a mock, and no process is started.
const GIT = "git";
const hit = (rule: string): Hit => ({ action: "block", rule, message: rule });
const ctx: GuardContext = {
  root: "/repo",
  readFile: () => Promise.reject(new Error("no file in this unit")),
  cwd: "/repo",
  globMatches: () => Promise.resolve(false),
  modeOf: () => "enforce",
  denyRules: [],
};

beforeEach(() => {
  vi.mocked(commandOf).mockImplementation((tokens) => ({
    name: tokens[0] ?? "",
    args: tokens.slice(1),
  }));
  vi.mocked(isKore).mockReturnValue(false);
  vi.mocked(readsKoreKeychain).mockReturnValue(false);
  vi.mocked(secretBlock).mockReturnValue(hit("secret-path"));
  vi.mocked(keychainBlock).mockReturnValue(hit("secret-path"));
  vi.mocked(sopsBlock).mockImplementation((path) => hit(`sops:${path}`));
  vi.mocked(loadSopsPatterns).mockResolvedValue([]);
  vi.mocked(checkDenyAudit).mockReturnValue([]);
  for (const check of [
    checkAppendOnly,
    checkDenyRemovalBash,
    checkGuardrailBash,
    checkRulesetSyncBash,
    checkAgentStart,
    checkContext,
    checkDestructive,
    checkIdeaIssueBody,
    checkIdeaIssueClose,
    checkNoVerify,
  ]) {
    vi.mocked(check).mockReturnValue(null);
  }
});

describe("checkBashSegment gates", () => {
  it("returns nothing for a segment with no command name", async () => {
    vi.mocked(commandOf).mockReturnValue({ name: "", args: [] });
    expect(await checkBashSegment(["FOO=1"], ctx)).toEqual([]);
    expect(checkDestructive).not.toHaveBeenCalled();
  });

  it("blocks a command that names key or token material under .kore/, and runs no other rule", async () => {
    expect(
      await checkBashSegment(["cat", ".kore/keys/writer.pem"], ctx),
    ).toEqual([hit("secret-path")]);
    expect(secretBlock).toHaveBeenCalledTimes(1);
    expect(checkDestructive).not.toHaveBeenCalled();
  });

  it("lets a safe reader and kore itself name that material", async () => {
    await checkBashSegment(["ls", ".kore/keys/writer.pem"], ctx);
    vi.mocked(isKore).mockReturnValue(true);
    await checkBashSegment(["kore", ".kore/keys/writer.pem"], ctx);
    expect(secretBlock).not.toHaveBeenCalled();
    expect(checkDestructive).toHaveBeenCalledTimes(2);
  });

  it("blocks a keychain dump or an identity read before any other rule", async () => {
    vi.mocked(readsKoreKeychain).mockReturnValue(true);
    expect(await checkBashSegment(["security", "dump-keychain"], ctx)).toEqual([
      hit("secret-path"),
    ]);
    expect(readsKoreKeychain).toHaveBeenCalledWith("security", [
      "dump-keychain",
    ]);
    expect(checkDestructive).not.toHaveBeenCalled();
  });
});

describe("checkBashSegment rules", () => {
  it("runs every segment rule with the command's name, arguments and context, and returns their findings in order", async () => {
    const segment = ["git", "push", "--no-verify"];
    vi.mocked(checkNoVerify).mockReturnValue(hit("no-verify"));
    vi.mocked(checkDenyAudit).mockReturnValue([hit("audit-deny")]);
    const findings = await checkBashSegment(segment, ctx);
    expect(checkNoVerify).toHaveBeenCalledWith(GIT, ["push", "--no-verify"]);
    expect(checkAppendOnly).toHaveBeenCalledWith(
      GIT,
      ["push", "--no-verify"],
      segment,
      "/repo",
    );
    expect(checkDenyAudit).toHaveBeenCalledWith(
      "Bash",
      "git push --no-verify",
      ctx,
    );
    expect(findings.filter((finding) => finding !== null)).toEqual([
      hit("no-verify"),
      hit("audit-deny"),
    ]);
  });

  it("keeps the rule's null as no finding, and reports only the rules that fire", async () => {
    vi.mocked(checkContext).mockReturnValue(hit("context"));
    const findings = await checkBashSegment(["kubectl", "get", "pods"], ctx);
    expect(findings.filter((finding) => finding !== null)).toEqual([
      hit("context"),
    ]);
  });

  it("writes a sops-encrypted path with a redirect, and blocks it", async () => {
    vi.mocked(loadSopsPatterns).mockResolvedValue([/secrets\.enc\.yaml$/]);
    const findings = await checkBashSegment(
      ["echo", "x", ">infra/secrets.enc.yaml"],
      ctx,
    );
    expect(loadSopsPatterns).toHaveBeenCalledWith(ctx);
    expect(sopsBlock).toHaveBeenCalledWith("infra/secrets.enc.yaml");
    expect(findings).toContainEqual(hit("sops:infra/secrets.enc.yaml"));
  });

  it("leaves a write to a path no sops pattern covers, and a sops command itself, alone", async () => {
    vi.mocked(loadSopsPatterns).mockResolvedValue([/secrets\.enc\.yaml$/]);
    await checkBashSegment(["tee", "notes.txt"], ctx);
    expect(sopsBlock).not.toHaveBeenCalled();
    await checkBashSegment(["sops", "infra/secrets.enc.yaml"], ctx);
    expect(loadSopsPatterns).toHaveBeenCalledTimes(1);
  });
});
