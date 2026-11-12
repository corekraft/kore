// Command rules: what a single command may do. Blocks: kubectl-context,
// helm-context, destructive, no-verify. Audit mode (warn): idea-issue-body,
// idea-issue-close.
import { firstPositional, hasFlag, isKore } from "./guard-shell.js";
import { block, warn, type Finding } from "./guard-verdict.js";

const KUBECTL_OFFLINE = new Set([
  "config",
  "completion",
  "help",
  "kustomize",
  "plugin",
]);
const HELM_CLUSTER = new Set([
  "install",
  "upgrade",
  "uninstall",
  "list",
  "ls",
  "status",
  "rollback",
  "get",
  "test",
  "history",
]);

export function checkContext(name: string, args: string[]): Finding {
  if (name === "kubectl") {
    const sub = firstPositional(args);
    const offline =
      !sub ||
      KUBECTL_OFFLINE.has(sub) ||
      (sub === "version" && args.includes("--client"));
    if (!offline && !hasFlag(args, "--context")) {
      return block(
        "kubectl-context",
        "kubectl ran without --context, so it would target whatever context is current. " +
          "Instead, pass --context with the environment's configured context (for example --context kore-local).",
      );
    }
  }
  if (name === "helm") {
    const sub = firstPositional(args);
    if (sub && HELM_CLUSTER.has(sub) && !hasFlag(args, "--kube-context")) {
      return block(
        "helm-context",
        "helm ran without --kube-context, so it would target whatever context is current. " +
          "Instead, pass --kube-context with the environment's configured context.",
      );
    }
  }
  return null;
}

const destructive = (): Finding =>
  block(
    "destructive",
    "Destructive operations need a human's explicit consent. " +
      "Instead, ask the user to run the command themselves (for example with `! <command>`), or use a non-destructive alternative.",
  );

function deletesK3dCluster(args: string[]): boolean {
  const positional = args.filter((arg) => !arg.startsWith("-"));
  const clusterAt = positional.indexOf("cluster");
  return clusterAt >= 0 && positional.indexOf("delete", clusterAt) >= 0;
}

function deletesNamespace(args: string[]): boolean {
  const positional = args.filter((arg) => !arg.startsWith("-"));
  const deleteAt = positional.indexOf("delete");
  return (
    deleteAt >= 0 &&
    ["namespace", "namespaces", "ns"].includes(positional[deleteAt + 1] ?? "")
  );
}

function isDestructive(name: string, args: string[]): boolean {
  switch (name) {
    case "k3d":
      return deletesK3dCluster(args);
    case "tofu":
    case "terraform":
      return args.includes("destroy");
    case "helm":
      return firstPositional(args) === "uninstall";
    case "kubectl":
      return deletesNamespace(args);
    default:
      return isKore(name, args) && args.includes("destroy");
  }
}

export function checkDestructive(name: string, args: string[]): Finding {
  return isDestructive(name, args) ? destructive() : null;
}

export function checkNoVerify(name: string, args: string[]): Finding {
  if (name !== "git") {
    return null;
  }
  const commitAt = args.indexOf("commit");
  if (commitAt < 0) {
    return null;
  }
  const skips = args
    .slice(commitAt + 1)
    .some((arg) => arg === "--no-verify" || /^-[A-Za-z]*n[A-Za-z]*$/.test(arg));
  if (!skips) {
    return null;
  }
  return block(
    "no-verify",
    "Skipping commit hooks bypasses formatting, lint, and commit-message checks. " +
      "Instead, fix what the hook reports and commit again without --no-verify.",
  );
}

// Idea issue bodies: rendered from docs/ideas by `harness idea sync` (ADR 0079), the only
// writer. A hand-written body is overwritten by the next sync. The guard cannot tell which
// issues are ideas, so it warns on any issue-body edit. Audit mode (warn) first, per ADR 0080.
const BODY_FLAGS = ["--body", "--body-file", "-b", "-F", "--title", "-t"];

export function checkIdeaIssueBody(name: string, args: string[]): Finding {
  if (name !== "gh" || args[0] !== "issue" || args[1] !== "edit") {
    return null;
  }
  if (!BODY_FLAGS.some((flag) => hasFlag(args, flag))) {
    return null;
  }
  return warn(
    "idea-issue-body",
    "Issue titles and bodies for ideas are rendered from docs/ideas and overwritten by the next sync. " +
      "Instead, edit the idea's markdown and run `harness idea sync --idea <number or slug>`; " +
      "use labels, assignees and comments for anything workflow-related.",
  );
}

// Closing an idea's issue and its outcome labels belong to `harness outcome` (ADR 0079): the
// tool refuses to close without a recorded outcome and keeps exactly one outcome label. The
// guard cannot tell which issues are ideas, so it warns on any such call. Audit mode (warn).
const OUTCOME_LABEL = /(^|,)outcome:/;

function labelValues(args: string[], flag: string): string[] {
  return args.flatMap((arg, i) => {
    if (arg.startsWith(`${flag}=`)) {
      return [arg.slice(flag.length + 1)];
    }
    const value = args[i + 1];
    return arg === flag && value !== undefined ? [value] : [];
  });
}

export function checkIdeaIssueClose(name: string, args: string[]): Finding {
  if (name !== "gh" || args[0] !== "issue") {
    return null;
  }
  const closing = args[1] === "close";
  const labelling =
    args[1] === "edit" &&
    ["--add-label", "-l"].some((flag) =>
      labelValues(args, flag).some((v) => OUTCOME_LABEL.test(v)),
    );
  if (!closing && !labelling) {
    return null;
  }
  return warn(
    "idea-issue-close",
    "An idea's issue closes, and takes its outcome:* label, only through the outcome tool, which refuses to close without a recorded outcome. " +
      "Instead, run `harness outcome record` to record the outcome, or `harness outcome close --idea <number or slug>` to finish closing one already recorded.",
  );
}
