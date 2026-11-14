/** The merge time of a PR from `gh pr view --json mergedAt`; undefined when the output is not JSON. */
export function parseExpandPr(
  stdout: string,
): { mergedAt: string | undefined } | undefined {
  try {
    const view = JSON.parse(stdout) as { mergedAt?: unknown };
    return {
      mergedAt: typeof view.mergedAt === "string" ? view.mergedAt : undefined,
    };
  } catch {
    return undefined;
  }
}
