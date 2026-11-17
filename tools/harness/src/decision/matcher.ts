// The deterministic matcher the question router runs over a question and its proposed action
// (ADR 0120). It is a backstop: a match routes the question to the owner, and a miss proves nothing.
import { SECRET_PATH } from "../hook/index.js";
import { reservedCategory } from "./reserved.js";

/** The name a match on the advisor's own files carries (ADR 0120: a question naming them is the owner's). */
export const ADVISOR_FILES = "advisor-files";

/** The name a match on the guard's secret-path pattern carries. */
export const SECRET_PATH_RULE = "secret-path";

/**
 * The advisor's own files: its definition, the decision tool and reserved list, and the
 * router and matcher beside them. Any path under decision/ counts, so a question that cites
 * one is routed to the owner rather than judged (fail closed).
 */
const ADVISOR_OWN_FILES =
  /\bdecision\/[\w.-]+|\bagents\/advisor\b|\bdecision-commands\b/;

/**
 * The name of the first library entry the text matches, or undefined when none does. The
 * library is the reserved categories (their names are the owner's), the guard's secret-path
 * pattern, and the advisor's own files, in that order.
 */
export function matchedBy(text: string): string | undefined {
  if (ADVISOR_OWN_FILES.test(text)) {
    return ADVISOR_FILES;
  }
  if (SECRET_PATH.test(text)) {
    return SECRET_PATH_RULE;
  }
  return reservedCategory(text);
}
