import { join } from "node:path";
import type { Repository } from "../config/index.js";
import { CommandError, type Runner } from "../runtime/index.js";
import { reasonOf, type MissingPrerequisite } from "./preflight-message.js";

// Docs: docs/decisions/0147-vps-v1-is-every-applicable-flag-proven-live-one-per-run-from-release-locks.md, docs/decisions/0151-host-and-k3s-changes-follow-the-same-safety-patterns-and-run-in-a-maintenance-window.md

const HOST = "kore-vps";
const HOST_DIRECTORY = "infra/hosts/vps";
/** The check reaches the host over the tailnet and runs a whole converge in check mode, so it gets minutes, not seconds. */
const CHECK_TIMEOUT_MS = 10 * 60_000;
const RECAP =
  /^kore-vps\s*:.*?\bchanged=(\d+)\s+unreachable=(\d+)\s+failed=(\d+)/m;
const FIX =
  "review the host diff with mise run vps-check, land the host change through its own check-mode run and Ansible apply (ADR 0151), then rerun the preflight";

/**
 * Whether converging kore-vps would change nothing: the check-mode run of the
 * host playbook (`mise run vps-check`) must show it changed, unreachable and
 * failed zero tasks. The diff is captured and never echoed, since a host diff
 * can carry a secret (ADR 0168). Read-only: check mode mutates nothing.
 */
export async function hostProblems(
  repository: Repository,
  runner: Runner,
): Promise<MissingPrerequisite[]> {
  const name = "host check-mode diff";
  let output: string;
  try {
    const result = await runner.run(
      "ansible-playbook",
      ["--check", "--diff", "site.yaml"],
      {
        cwd: join(repository.root, HOST_DIRECTORY),
        capture: true,
        timeoutMs: CHECK_TIMEOUT_MS,
      },
    );
    output = result.stdout;
  } catch (error) {
    // Ansible exits non-zero when it finds an unreachable or failed host, and the
    // runner throws with that stdout. Its recap names the cause, so report it first.
    const recap =
      error instanceof CommandError ? RECAP.exec(error.result.stdout) : null;
    const cause = recap === null ? null : uncleanRecap(name, recap);
    if (cause !== null) {
      return [cause];
    }
    // An expected failure: the check cannot reach or run the host. Named, not thrown.
    return [
      {
        name,
        problem: `the check-mode run of ${HOST} did not complete: ${reasonOf(error)}`,
        fix: "run mise run vps-check from kore-agents and fix what it reports, then rerun the preflight",
      },
    ];
  }
  const recap = RECAP.exec(output);
  if (recap === null) {
    return [
      {
        name,
        problem: `the check-mode run printed no PLAY RECAP for ${HOST}`,
        fix: "run mise run vps-check from kore-agents and read what it reports, then rerun the preflight",
      },
    ];
  }
  const cause = uncleanRecap(name, recap);
  return cause === null ? [] : [cause];
}

/** The missing prerequisite a recap names, or null when the recap shows no change, unreachable or failed host. */
function uncleanRecap(
  name: string,
  recap: RegExpExecArray,
): MissingPrerequisite | null {
  const [, changed = "0", unreachable = "0", failed = "0"] = recap;
  if (changed === "0" && unreachable === "0" && failed === "0") {
    return null;
  }
  return {
    name,
    problem: `the check-mode run of ${HOST} is not clean: changed=${changed} unreachable=${unreachable} failed=${failed}, so the host has a change not yet applied or cannot be checked`,
    fix: FIX,
  };
}
