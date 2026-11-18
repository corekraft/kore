// The owner login and the reviewer logins of the harness config, each checked; a bad one names its
// key and the fix.

import { bad, type Failure, type Raw } from "./cost-config-support.js";

const LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
/** A GitHub App's login as gh reports it on the App's comments and PRs: `app/<slug>`. */
const APP_LOGIN = /^app\/[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;

function reviewerLoginsOf(
  file: string,
  value: unknown,
): { reviewerLogins?: string[] } | Failure {
  if (value === undefined) {
    return {};
  }
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every(
      (r) => typeof r === "string" && (LOGIN.test(r) || APP_LOGIN.test(r)),
    )
  ) {
    return bad(
      file,
      "reviewerLogins",
      'must be a non-empty list of GitHub logins of letters, digits and "-", or of a GitHub App as app/<slug>. Use ["junners"] or ["junners", "app/kore-reviewer"], or remove the key to trust the owner login.',
    );
  }
  return { reviewerLogins: value as string[] };
}

/** The owner login and the reviewer logins, each checked; a bad one names its key and the fix. */
export function loginsOf(
  file: string,
  value: Raw,
): { ownerLogin?: string; reviewerLogins?: string[] } | Failure {
  const login = value["ownerLogin"];
  if (
    login !== undefined &&
    (typeof login !== "string" || !LOGIN.test(login))
  ) {
    return bad(
      file,
      "ownerLogin",
      'must be a GitHub login of letters, digits and "-". Use "junners".',
    );
  }
  const reviewers = reviewerLoginsOf(file, value["reviewerLogins"]);
  if ("error" in reviewers) {
    return reviewers;
  }
  return {
    ...(login === undefined ? {} : { ownerLogin: login as string }),
    ...reviewers,
  };
}
