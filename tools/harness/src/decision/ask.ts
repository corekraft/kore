// The owner question (ADR 0120): a pane's reserved question, posted at once on the idea's issue under
// the sender line with an existing label, and recorded as decision.routed to the owner. Consent for a
// destructive command is never routed here; it stays inline with its gate.
import type { DecisionRouteSignal } from "../ledger/index.js";
import { signedBody } from "../sender/index.js";
import {
  CATEGORY_NAME,
  DECISION_FLAG,
  DecisionError,
  type DecisionTarget,
} from "./decision.js";
import { classify } from "./route.js";
import { reservedCategory } from "./reserved.js";

/** The existing label that puts the issue in the owner's queue (docs/agents/triage-labels.md). */
export const ASK_LABEL = "needs-info";

export interface AskInput {
  /** The idea the question is about, as the pane names it. */
  readonly idea: string;
  /** The category the asking pane declared. */
  readonly category: string;
  readonly question: string;
  /** What the pane would do if the question were answered yes. */
  readonly action: string;
}

export interface AskPorts {
  /** The spawn environment the sender line is read from. */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly flagOn: () => Promise<boolean>;
  readonly target: (idea: string) => Promise<DecisionTarget>;
  /** Adds the label to the issue. */
  readonly label: (target: DecisionTarget, label: string) => Promise<void>;
  /** Posts the comment and returns its URL. */
  readonly post: (target: DecisionTarget, body: string) => Promise<string>;
  /** Records decision.routed: the idea, the category, the route and the signal, never the text. */
  readonly record: (event: {
    idea: string;
    label: string;
    route: "owner";
    signal: DecisionRouteSignal;
  }) => Promise<{ ok: true } | { ok: false; message: string }>;
}

export interface Asked {
  readonly idea: string;
  readonly category: string;
  readonly issue: string;
  readonly commentUrl: string;
  readonly signal: DecisionRouteSignal;
}

function checked(input: AskInput): void {
  if (!CATEGORY_NAME.test(input.category)) {
    throw new DecisionError(
      `--category "${input.category}" is not a category name: use lowercase letters, digits and "-", starting with a letter, such as "naming".`,
    );
  }
  for (const field of ["question", "action"] as const) {
    if (input[field].trim() === "") {
      throw new DecisionError(
        `--${field} is empty; say what is asked and what the pane would do.`,
      );
    }
  }
}

/**
 * Posts one reserved question on the idea's issue and records decision.routed to the owner.
 * Refused with nothing posted while the flag is off, for an invalid input, for a consent prompt
 * (a destructive action), for a question the advisor decides, and when the sender line cannot be
 * written. The label goes on before the comment, so a refused comment leaves no label behind.
 */
export async function askOwner(
  ports: AskPorts,
  input: AskInput,
): Promise<Asked> {
  if (!(await ports.flagOn())) {
    throw new DecisionError(
      `The ${DECISION_FLAG} flag is off, so no question is posted. Ask the owner on the idea's issue; it is turned on only with \`harness flag activate ${DECISION_FLAG}\`.`,
    );
  }
  checked(input);
  if (reservedCategory(input.action) === "destruction") {
    throw new DecisionError(
      "The action is a destructive command, and consent for a destructive command is never routed (ADR 0120): it stays inline with its gate. Stop and report it; post nothing.",
    );
  }
  const routed = classify({
    idea: input.idea,
    category: input.category,
    question: input.question,
    action: input.action,
    escalate: false,
  });
  if (routed.route !== "owner") {
    throw new DecisionError(
      `The question is the advisor's, so it is not posted (signal: ${routed.signal}). Record its decision with \`harness decision make\` instead.`,
    );
  }
  const signed = signedBody(
    ports.env,
    "decision ask",
    `Question for the owner (${input.category}): ${input.question}\n\nProposed action: ${input.action}\n\nAnswer with a plain comment on this issue.`,
  );
  if ("error" in signed) {
    throw new DecisionError(signed.error);
  }
  const target = await ports.target(input.idea);
  await ports.label(target, ASK_LABEL);
  const commentUrl = await ports.post(target, signed.body);
  const recorded = await ports.record({
    idea: target.idea,
    label: input.category,
    route: "owner",
    signal: routed.signal,
  });
  if (!recorded.ok) {
    throw new DecisionError(
      `The question was posted at ${commentUrl}, but its route was not recorded: ${recorded.message} Do not ask the owner again.`,
    );
  }
  return {
    idea: target.idea,
    category: input.category,
    issue: `https://github.com/${target.repo}/issues/${target.number}`,
    commentUrl,
    signal: routed.signal,
  };
}
