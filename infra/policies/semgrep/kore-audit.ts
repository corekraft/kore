// Semgrep rule tests for kore-audit.yaml: `mise run scan-sast-test`.
// The rule's `paths.exclude` (runtime/main-root.ts, runtime/root.ts) is not
// exercised here: semgrep --test runs rules against this file only.

declare const deps: { cwd: string };

// ruleid: kore-harness-process-cwd
const launchedIn = process.cwd();
// ruleid: kore-harness-process-cwd
console.log(`${process.cwd()}/infra/plans`);
// ok: kore-harness-process-cwd
const injected = deps.cwd;
// ok: kore-harness-process-cwd
const cwdName = "process.cwd";

export { launchedIn, injected, cwdName };
