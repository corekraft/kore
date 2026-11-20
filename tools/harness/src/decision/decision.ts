import { signedBody } from "../sender/index.js";
import { reservedCategory } from "./reserved.js";

/** The flag the advisor and its tool sit behind (ADR 0120); off until a person activates it. */
export const DECISION_FLAG = "decision-advisor";

/** A refusal the caller can act on; every other error is rethrown. */
export class DecisionError extends Error {}

export interface DecisionInput {
  /** The idea whose issue the decision is recorded on; exactly one of idea and issue is given. */
  readonly idea?: string;
  /** A plain ticket's issue number, for a ticket that has no idea record. */
  readonly issue?: string;
  /** The category the asking pane declared; never a reserved one. */
  readonly category: string;
  readonly question: string;
  readonly decision: string;
}

/** Where a decision is posted: the issue's number and repository. */
export interface IssueTarget {
  readonly number: string;
  readonly repo: string;
}

export interface DecisionTarget extends IssueTarget {
  /** The idea's number, as its record writes it. */
  readonly idea: string;
}

/** What the tool reaches outside itself through: the overlay, the idea records, gh and the ledger. */
export interface DecisionPorts {
  /** The spawn environment the sender line is read from. */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly flagOn: () => Promise<boolean>;
  readonly target: (idea: string) => Promise<DecisionTarget>;
  /** Resolves a plain ticket's issue number to the repository it is in. */
  readonly issue: (number: string) => Promise<IssueTarget>;
  /** Posts the comment and returns its URL. */
  readonly post: (target: IssueTarget, body: string) => Promise<string>;
  /** Records decision.made: the idea, the issue it was posted on and the category, never the question or the reasoning. */
  readonly record: (event: {
    idea?: string;
    label: string;
    number: number;
  }) => Promise<{ ok: true } | { ok: false; message: string }>;
}

export interface Made {
  /** Absent when the decision was made on a plain ticket. */
  readonly idea?: string;
  readonly category: string;
  readonly issue: string;
  readonly commentUrl: string;
}

/** A category name: lowercase letters, digits and "-", starting with a letter, at most 64 characters. */
export const CATEGORY_NAME = /^[a-z][a-z0-9-]{0,63}$/;

function checked(input: DecisionInput): void {
  const idea = (input.idea ?? "").trim();
  const issue = (input.issue ?? "").trim();
  if ((idea === "") === (issue === "")) {
    throw new DecisionError(
      "Give exactly one of --idea and --issue: --idea is an idea's number or slug, --issue a plain ticket's issue number; not both, and not neither.",
    );
  }
  if (issue !== "" && !/^[1-9]\d*$/.test(issue)) {
    throw new DecisionError(
      `--issue "${issue}" is not an issue number: give the number alone, such as 1435.`,
    );
  }
  if (!CATEGORY_NAME.test(input.category)) {
    throw new DecisionError(
      `--category "${input.category}" is not a category name: use lowercase letters, digits and "-", starting with a letter, such as "naming".`,
    );
  }
  for (const field of ["question", "decision"] as const) {
    if (input[field].trim() === "") {
      throw new DecisionError(
        `--${field} is empty; say what was asked and what was decided.`,
      );
    }
  }
}

/** Refuses a question the reserved list covers, and a category that is itself a reserved one. */
function refuseReserved(input: DecisionInput): void {
  const matched = reservedCategory(input.question);
  if (matched !== undefined) {
    throw new DecisionError(
      `The question matches the reserved category "${matched}", which belongs to the owner (ADR 0120). Record no decision; ask the owner on the idea's issue instead.`,
    );
  }
  if (reservedCategory(input.category) !== undefined) {
    throw new DecisionError(
      `The category "${input.category}" is reserved, so a decision cannot be recorded under it. Declare the category the question belongs to, or ask the owner.`,
    );
  }
}

/**
 * Records one advisor decision: posts it on the idea's issue under the sender line, then
 * records decision.made. Refused with nothing posted while the flag is off, when the
 * question or its category is reserved, and when the sender line cannot be written.
 */
export async function makeDecision(
  ports: DecisionPorts,
  input: DecisionInput,
): Promise<Made> {
  if (!(await ports.flagOn())) {
    throw new DecisionError(
      `The ${DECISION_FLAG} flag is off, so no decision is recorded. It is turned on only with \`harness flag activate ${DECISION_FLAG}\`.`,
    );
  }
  checked(input);
  refuseReserved(input);
  const target: IssueTarget & { readonly idea?: string } =
    (input.issue ?? "").trim() !== ""
      ? await ports.issue((input.issue ?? "").trim())
      : await ports.target((input.idea ?? "").trim());
  const signed = signedBody(
    ports.env,
    "decision make",
    `Decision (${input.category})\n\nQuestion: ${input.question}\n\nDecision: ${input.decision}`,
  );
  if ("error" in signed) {
    throw new DecisionError(signed.error);
  }
  const commentUrl = await ports.post(target, signed.body);
  const where =
    target.idea === undefined
      ? `--number ${target.number}`
      : `--idea ${target.idea}`;
  const recorded = await ports.record({
    ...(target.idea === undefined ? {} : { idea: target.idea }),
    label: input.category,
    number: Number(target.number),
  });
  if (!recorded.ok) {
    throw new DecisionError(
      `The decision was posted at ${commentUrl}, but its ledger event was rejected: ${recorded.message} Record it with \`harness ledger record --source claude --kind decision.made ${where} --label ${input.category} --occurred-at <now, ISO 8601 UTC>\`; do not post the decision again.`,
    );
  }
  return {
    ...(target.idea === undefined ? {} : { idea: target.idea }),
    category: input.category,
    issue: `https://github.com/${target.repo}/issues/${target.number}`,
    commentUrl,
  };
}
