// The writer's own check on its pull request (idea 0010): the judge's checklist read the way
// the writer must act on it. A failing enforce item is a fault the writer owns; a pending one
// is CI or a review the judge waits on; an audit item is reported by the judge and is never
// either here.
import type { SendBackCategory } from "../ledger/index.js";
import type { AuditFinding, ItemVerdict } from "./checks.js";
import type { Report } from "./precheck.js";

/** The send-back categories a writer can be faulted with; the ledger counts them by these names. */
export type AuthorCategory = Extract<
  SendBackCategory,
  | "declaration"
  | "pattern-mismatch"
  | "failed-check"
  | "missing-proof"
  | "rule-break"
>;

export interface AuthorFailure {
  category: AuthorCategory;
  item: string;
  detail?: string;
}

export interface AuthorCheck {
  pr: number;
  /** True when no failure the writer owns remains; pending items do not make it false. */
  ok: boolean;
  failures: AuthorFailure[];
  /** The enforce items still running or unposted, which the judge waits on. */
  pending: string[];
  /** Present only when a changed file is over a limit: shown to the writer, never counted as a failure. */
  audits?: AuditFinding[];
}

const CATEGORY: Partial<Record<string, AuthorCategory>> = {
  "pattern-match": "pattern-mismatch",
  "expand-step": "missing-proof",
  "guardrail-activation": "rule-break",
};

const categoryOf = (item: string): AuthorCategory =>
  CATEGORY[item] ?? "failed-check";

const PENDING = new Set<ItemVerdict["result"]>([
  "pending",
  "missing",
  "unverified",
]);

/** Classifies a judge report as the writer must read it: failures it owns, and items still pending. */
export function authorCheck(
  report: Pick<Report, "pr" | "declaration" | "checklist" | "audits">,
): AuthorCheck {
  if (!report.declaration.ok) {
    const detail = report.declaration.reason;
    return {
      pr: report.pr,
      ok: false,
      failures: [
        {
          category: "declaration",
          item: "declaration",
          ...(detail === undefined ? {} : { detail }),
        },
      ],
      pending: [],
    };
  }
  const enforced = (report.checklist ?? []).filter((i) => i.mode === "enforce");
  const failures = enforced
    .filter((i) => i.result === "fail")
    .map((i) => ({
      category: categoryOf(i.item),
      item: i.item,
      ...(i.detail === undefined ? {} : { detail: i.detail }),
    }));
  return {
    pr: report.pr,
    ok: failures.length === 0,
    failures,
    pending: enforced.filter((i) => PENDING.has(i.result)).map((i) => i.item),
    ...(report.audits === undefined ? {} : { audits: report.audits }),
  };
}
