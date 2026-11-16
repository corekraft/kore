// The one list of guard roles (ADR 0078, ADR 0080). The guard rules read these groups. The bypass
// corpus (guard-corpus.ts) keeps its own role lists on purpose and is checked AGAINST this registry
// by roleCoverage in guard-corpus.spec.ts: that check fails in CI when a registry role has no corpus
// case or a corpus case names a role the registry lacks.

/** Roles that read and report and never write a file. */
export const READ_ONLY_ROLES = ["reader", "principles-review"];

/** Roles that answer from plans, ADRs, ideas and issues and never read code. No role is one today; the `role-no-code` rule bounds one when it is named here. */
export const NO_CODE_ROLES: string[] = [];

/** Roles the harness spawns in a pane for one notice, with no allowlist of its own. */
export const SPAWNED_ROLES = ["reader", "principles-review"];

/** Delivery roles that read and report: they may run the harness and gh/git queries but change no file. */
export const REPORTING_ROLES = ["judge"];

/** Every guard role, once, in the order the guard reads them. */
export const GUARD_ROLES = [...READ_ONLY_ROLES, ...REPORTING_ROLES, "writer"];

/** Delivery roles: the reporting roles and the writer, which alone may change files in its worktree. */
export const DELIVERY_ROLES = new Set<string>([...REPORTING_ROLES, "writer"]);
