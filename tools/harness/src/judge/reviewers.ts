import { JudgeError } from "./errors.js";

export interface ReviewerSources {
  /** The --reviewer flag as given, or undefined when absent. It overrides the other sources. */
  flag?: string | undefined;
  /** The reviewerLogins list from the harness config, when one is set. */
  configured?: readonly string[] | undefined;
  /** The configured owner login, else the repository's owner. */
  owner: string;
}

/**
 * The logins whose principles-review verdicts the judge trusts: the --reviewer flag when
 * given, else the configured list, else the owner login. A flag that names no login is
 * refused rather than read as an empty trust list.
 */
export function reviewersFor(sources: ReviewerSources): string[] {
  if (sources.flag !== undefined) {
    const named = sources.flag
      .split(",")
      .map((login) => login.trim())
      .filter((login) => login !== "");
    if (named.length === 0) {
      throw new JudgeError(
        "--reviewer names no login. Use --reviewer <login>[,<login>], or omit it to trust the configured reviewers.",
      );
    }
    return named;
  }
  return sources.configured !== undefined && sources.configured.length > 0
    ? [...sources.configured]
    : [sources.owner];
}
