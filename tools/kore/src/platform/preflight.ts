import type { Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { hostProblems } from "./preflight-host.js";
import { kubeProblems } from "./preflight-kube.js";
import { lockProblems } from "./preflight-locks.js";
import {
  renderMissing,
  type MissingPrerequisite,
} from "./preflight-message.js";
import { sopsProblems } from "./preflight-sops.js";

// Docs: docs/decisions/0147-vps-v1-is-every-applicable-flag-proven-live-one-per-run-from-release-locks.md

/** The one environment whose `platform up` is preflighted (ADR 0147). */
const preflightedEnvironment = "vps";

/** The two release lock paths a run was given, either of which may be absent. */
export interface PreflightLocks {
  chartLock: string | undefined;
  templateLock: string | undefined;
}

/**
 * Before the first mutation of `kore platform up --environment vps`, names every
 * missing prerequisite at once and changes nothing: the sops recipient and its
 * creation rule, the release chart and image locks, the kube context's
 * reachability over the tailnet, and a host with no check-mode diff. Every check
 * runs, so the refusal lists all of them with the fix for each, and throws. Only
 * read-only commands are asked of the runner. Any other environment passes
 * untouched.
 */
export async function platformPreflight(
  repository: Repository,
  runner: Runner,
  locks: PreflightLocks,
): Promise<void> {
  const name = repository.environment.name;
  if (name !== preflightedEnvironment) {
    return;
  }
  const missing: MissingPrerequisite[] = [
    ...sopsProblems(repository),
    ...(await lockProblems(locks)),
    ...(await kubeProblems(repository, runner)),
    ...(await hostProblems(repository, runner)),
  ];
  if (missing.length > 0) {
    throw new Error(renderMissing(name, missing));
  }
}
