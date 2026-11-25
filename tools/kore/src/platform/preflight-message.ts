// Docs: docs/decisions/0147-vps-v1-is-every-applicable-flag-proven-live-one-per-run-from-release-locks.md

/** One prerequisite a `platform up` preflight found missing, with the step that fixes it. */
export interface MissingPrerequisite {
  /** The prerequisite as an operator names it, such as "release chart lock". */
  name: string;
  /** What is wrong, as one clause with no full stop. */
  problem: string;
  /** The step that fixes it, as one clause with no full stop. */
  fix: string;
}

/**
 * The first line of a failure, with any API server address replaced: the
 * address of a tailnet host never reaches a message or a log.
 */
export function reasonOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const [first = ""] = text.split("\n");
  return first.replace(/https?:\/\/\S+?(?=:\s|\s|$)/g, "the API server");
}

/**
 * The one message a refused preflight prints: every missing prerequisite with
 * its fix, and that the run stopped before it changed anything.
 */
export function renderMissing(
  environment: string,
  missing: readonly MissingPrerequisite[],
): string {
  const count =
    missing.length === 1
      ? "1 prerequisite is"
      : `${missing.length} prerequisites are`;
  const lines = missing.map(
    ({ name, problem, fix }) => `- ${name}: ${problem}. Fix: ${fix}`,
  );
  return [
    `kore platform up --environment ${environment} stopped before any change: ${count} missing.`,
    ...lines,
  ].join("\n");
}
