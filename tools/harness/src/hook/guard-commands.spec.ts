// Command rules: each rule's command shapes, and the context, destructive, no-verify and idea-issue findings. Shell helpers and verdict constructors are mocked.

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as commands from "./guard-commands.js";
import {
  checkContext,
  checkDestructive,
  checkIdeaIssueBody,
  checkIdeaIssueClose,
  checkNoVerify,
} from "./guard-commands.js";
import { firstPositional, hasFlag, isKore } from "./guard-shell.js";
import { block, warn, type Hit } from "./guard-verdict.js";

vi.mock("./guard-agent-start.js", () => ({ checkAgentStart: vi.fn() }));
vi.mock("./guard-shell.js", () => ({
  firstPositional: vi.fn(),
  hasFlag: vi.fn(),
  isKore: vi.fn(),
}));
vi.mock("./guard-verdict.js", () => ({ block: vi.fn(), warn: vi.fn() }));

// The command name the rules are given as data: each rule is called, and no process is started.
const GIT = "git";

beforeEach(() => {
  // Typed stand-ins for the shell helpers, with the same meaning as the real ones.
  vi.mocked(firstPositional).mockImplementation((args) =>
    args.find((a) => !a.startsWith("-")),
  );
  vi.mocked(hasFlag).mockImplementation((args, flag) =>
    args.some((a) => a === flag || a.startsWith(`${flag}=`)),
  );
  vi.mocked(isKore).mockReturnValue(false);
  vi.mocked(block).mockImplementation((rule): Hit => ({
    action: "block",
    rule,
    message: rule,
  }));
  vi.mocked(warn).mockImplementation((rule): Hit => ({
    action: "warn",
    rule,
    message: rule,
  }));
});

describe("module surface", () => {
  it("exports only the command rules it owns, so no glob rule is re-exported through it", () => {
    expect(Object.keys(commands).sort()).toEqual([
      "checkAgentStart",
      "checkContext",
      "checkDestructive",
      "checkIdeaIssueBody",
      "checkIdeaIssueClose",
      "checkNoVerify",
    ]);
  });
});

describe("checkContext", () => {
  it("blocks kubectl that names a subcommand without --context", () => {
    expect(checkContext("kubectl", ["get", "pods"])).toMatchObject({
      rule: "kubectl-context",
    });
    expect(block).toHaveBeenCalledWith(
      "kubectl-context",
      expect.stringContaining("--context"),
    );
  });

  it("passes kubectl with --context, and kubectl commands that never reach a cluster", () => {
    expect(
      checkContext("kubectl", ["get", "pods", "--context=kore-local"]),
    ).toBeNull();
    expect(checkContext("kubectl", ["config", "view"])).toBeNull();
    expect(checkContext("kubectl", [])).toBeNull();
    expect(checkContext("kubectl", ["version", "--client"])).toBeNull();
    expect(block).not.toHaveBeenCalled();
  });

  it("blocks a cluster-touching helm command without --kube-context, and passes an offline one", () => {
    expect(checkContext("helm", ["upgrade", "app", "./chart"])).toMatchObject({
      rule: "helm-context",
    });
    expect(
      checkContext("helm", ["upgrade", "app", "--kube-context", "kore-local"]),
    ).toBeNull();
    expect(checkContext("helm", ["lint", "./chart"])).toBeNull();
  });

  it("ignores any other command", () => {
    expect(checkContext("ls", ["-la"])).toBeNull();
  });
});

describe("checkDestructive", () => {
  it("blocks deleting a k3d cluster in either argument order", () => {
    expect(
      checkDestructive("k3d", ["cluster", "delete", "kore-local"]),
    ).toMatchObject({
      rule: "destructive",
    });
    expect(
      checkDestructive("k3d", ["cluster", "--all", "delete"]),
    ).toMatchObject({
      rule: "destructive",
    });
    expect(checkDestructive("k3d", ["cluster", "list"])).toBeNull();
  });

  it("blocks destroy in tofu and terraform, and uninstall in helm", () => {
    expect(checkDestructive("tofu", ["apply", "destroy"])).toMatchObject({
      rule: "destructive",
    });
    expect(checkDestructive("terraform", ["destroy"])).toMatchObject({
      rule: "destructive",
    });
    expect(checkDestructive("helm", ["uninstall", "app"])).toMatchObject({
      rule: "destructive",
    });
    expect(checkDestructive("helm", ["list"])).toBeNull();
  });

  it("blocks deleting a namespace with kubectl, and not deleting a pod", () => {
    expect(
      checkDestructive("kubectl", ["delete", "namespace", "kore"]),
    ).toMatchObject({
      rule: "destructive",
    });
    expect(checkDestructive("kubectl", ["delete", "pod", "p"])).toBeNull();
  });

  it("blocks kore destroy only for the kore command itself", () => {
    vi.mocked(isKore).mockReturnValue(true);
    expect(checkDestructive("kore", ["destroy"])).toMatchObject({
      rule: "destructive",
    });
    vi.mocked(isKore).mockReturnValue(false);
    expect(checkDestructive("other", ["destroy"])).toBeNull();
  });
});

describe("checkNoVerify", () => {
  it("blocks a git commit that skips hooks, with --no-verify or a short -n flag", () => {
    expect(
      checkNoVerify(GIT, ["commit", "--no-verify", "-m", "x"]),
    ).toMatchObject({
      rule: "no-verify",
    });
    expect(checkNoVerify(GIT, ["commit", "-nm", "x"])).toMatchObject({
      rule: "no-verify",
    });
  });

  it("passes an ordinary commit, a push, and a non-git command", () => {
    expect(checkNoVerify(GIT, ["commit", "-m", "x"])).toBeNull();
    expect(checkNoVerify(GIT, ["push", "--no-verify"])).toBeNull();
    expect(checkNoVerify("npm", ["commit", "--no-verify"])).toBeNull();
  });
});

describe("checkIdeaIssueBody", () => {
  it("warns when an issue edit sets its body, file, title or a body flag", () => {
    expect(
      checkIdeaIssueBody("gh", ["issue", "edit", "3", "--body", "x"]),
    ).toMatchObject({
      rule: "idea-issue-body",
    });
    expect(
      checkIdeaIssueBody("gh", ["issue", "edit", "3", "--title", "t"]),
    ).toMatchObject({
      rule: "idea-issue-body",
    });
  });

  it("passes a label edit, a read, and any other command", () => {
    expect(
      checkIdeaIssueBody("gh", ["issue", "edit", "3", "--add-label", "x"]),
    ).toBeNull();
    expect(
      checkIdeaIssueBody("gh", ["issue", "view", "3", "--body"]),
    ).toBeNull();
    expect(checkIdeaIssueBody(GIT, ["issue", "edit", "--body"])).toBeNull();
  });
});

describe("checkIdeaIssueClose", () => {
  it("warns when an issue closes, and when an outcome label is added in either spelling", () => {
    expect(checkIdeaIssueClose("gh", ["issue", "close", "3"])).toMatchObject({
      rule: "idea-issue-close",
    });
    expect(
      checkIdeaIssueClose("gh", [
        "issue",
        "edit",
        "3",
        "--add-label",
        "outcome:confirmed",
      ]),
    ).toMatchObject({
      rule: "idea-issue-close",
    });
    expect(
      checkIdeaIssueClose("gh", [
        "issue",
        "edit",
        "3",
        "--add-label=outcome:x",
      ]),
    ).toMatchObject({
      rule: "idea-issue-close",
    });
  });

  it("passes other label edits, comments and reads", () => {
    expect(
      checkIdeaIssueClose("gh", [
        "issue",
        "edit",
        "3",
        "-l",
        "ready-for-agent",
      ]),
    ).toBeNull();
    expect(checkIdeaIssueClose("gh", ["issue", "comment", "3"])).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });
});
