// Changes a guardrail's mode, or removes it, only with a person's approval on the
// idea's issue: a comment from a named approver, made after the request comment,
// with one line `approve <rule>:<from>><to>`. A label never counts, and a
// refusal changes nothing but leaves a comment on the issue. An approving comment
// that carries a sender line still approves, but the result carries a warning and
// a ledger event: such a comment was written by a session, not by the owner.
// Plan: infra/plans/12-self-improving-loop.md (Step 4).

import {
  GuardrailError,
  INVENTORY_PATH,
  parseInventory,
  type Inventory,
} from "./inventory.js";
import { withMode, withoutRule } from "./edit.js";
import { marker as requestMarker, requestLabel } from "./request.js";
import { MAIN_SESSION, readSender } from "../sender/index.js";

const TARGETS: readonly string[] = ["enforce", "audit", "removed"];

export interface IssueComment {
  body: string;
  author: string;
  createdAt: string;
  /** The comment's web address, when the issue's comments carry one. */
  url?: string;
}

type Problem = { code: string; reason: string };

export interface ActivatePorts {
  inventory: Inventory;
  /** The inventory file as read, which the edit changes by line. */
  inventoryText: string;
  idea: { number: string; title: string; path: string; issue?: string };
  /** The logins whose comment is a person's approval. */
  approvers: readonly string[];
  /** The labels of the guardrail.requested events already recorded. */
  events(): Promise<{ label?: string }[]>;
  comments(issue: string): Promise<IssueComment[]>;
  labels(issue: string): Promise<string[]>;
  comment(issue: string, body: string): Promise<string>;
  writeInventory(text: string): Promise<void>;
  /** Regenerates the settings deny list from the changed inventory. */
  syncDeny(inventory: Inventory): Promise<void>;
  recordEvent(
    label: string,
    idea: string,
  ): Promise<{ ok: true } | { ok: false; message: string }>;
  /** Records that an approval carrying a sender line was used for the change. */
  recordWarning(
    label: string,
    idea: string,
  ): Promise<{ ok: true } | { ok: false; message: string }>;
}

export interface ActivateResult {
  rule: string;
  from: string;
  to: string;
  idea: string;
  issue: string;
  activated: boolean;
  reason?: string;
  refusalPosted?: boolean;
  commentUrl?: string;
  /** Set when the approving comment carries a sender line, so it is not the owner's. */
  warning?: string;
}

/** The one line a person writes to approve a change. */
export const approvalLine = (label: string): string => `approve ${label}`;

const refusalMarker = (label: string, code: string): string =>
  `<!-- guardrail-refusal: ${label} ${code} -->`;

const MARKED = /<!--/;

/** The warning for an approving comment that carries a sender line; undefined when it carries none. */
function senderWarning(
  label: string,
  approver: IssueComment,
): string | undefined {
  const sender = readSender(approver.body);
  if (sender === undefined) {
    return undefined;
  }
  const where =
    approver.url === undefined
      ? `the comment by ${approver.author} at ${approver.createdAt}`
      : `the comment ${approver.url}`;
  const who =
    sender.session === undefined
      ? MAIN_SESSION
      : `${sender.session.role} ${sender.session.name}`;
  return `The approval for ${label} is ${where}, posted by ${who} (${sender.command}) with a sender line, so it is not the owner's. The gate still accepts it; whether to refuse it is the owner's decision.`;
}

export class GuardrailActivate {
  constructor(private readonly ports: ActivatePorts) {}

  private check(input: { rule: string; to: string }) {
    const { idea, inventory } = this.ports;
    const found = inventory.guardrails.find((g) => g.rule === input.rule);
    if (found === undefined) {
      throw new GuardrailError(
        `No guardrail "${input.rule}" in ${INVENTORY_PATH}. Run \`harness guardrail status\` for the rule names.`,
      );
    }
    if (!TARGETS.includes(input.to)) {
      throw new GuardrailError(
        `Unknown target "${input.to}". Use enforce, audit or removed.`,
      );
    }
    if (found.mode === input.to) {
      throw new GuardrailError(
        `Guardrail "${input.rule}" is already in ${found.mode} mode. Pick ${found.mode === "audit" ? "enforce" : "audit"} or removed.`,
      );
    }
    if (idea.issue === undefined) {
      throw new GuardrailError(
        `Idea ${idea.number} has no issue, so there is no approval to read. Open one with \`harness idea sync\`, then rerun.`,
      );
    }
    return { guardrail: found, issue: idea.issue };
  }

  /** The comment that approves the change, or why it is not approved. */
  private async approval(
    label: string,
    rule: string,
    to: string,
    issue: string,
  ): Promise<{ approver: IssueComment } | { problem: Problem }> {
    const comments = await this.ports.comments(issue);
    const requested = (await this.ports.events()).some(
      (e) => e.label === label,
    );
    const asked = comments.find((c) => c.body.includes(requestMarker(label)));
    if (!requested || asked === undefined) {
      return {
        problem: {
          code: "no-request",
          reason: `No request is on record for ${label}. Run \`harness guardrail request ${rule} --to ${to} --idea ${this.ports.idea.number} ...\` first, then ask a person to approve.`,
        },
      };
    }
    const wanted = approvalLine(label);
    const approvers = this.ports.approvers.map((a) => a.toLowerCase());
    const approving = comments.filter(
      (c) =>
        approvers.includes(c.author.toLowerCase()) &&
        c.createdAt > asked.createdAt &&
        !MARKED.test(c.body) &&
        c.body.split("\n").some((line) => line.trim().toLowerCase() === wanted),
    );
    // An untagged approval is the owner's own, so it wins over a tagged one.
    const approver =
      approving.find((c) => readSender(c.body) === undefined) ?? approving[0];
    if (approver !== undefined) {
      return { approver };
    }
    const labelled = (await this.ports.labels(issue)).find((l) =>
      /approv/i.test(l),
    );
    const names = this.ports.approvers.join(" or ");
    return {
      problem: {
        code: "no-approval",
        reason:
          labelled === undefined
            ? `No approval is on record for ${label}. Ask ${names} to comment \`${wanted}\` on the issue of idea ${this.ports.idea.number}, then rerun.`
            : `A label is not an approval: the idea's issue carries the label ${labelled}, but only a comment from ${names} with the line \`${wanted}\` counts.`,
      },
    };
  }

  private async refuse(
    result: ActivateResult,
    label: string,
    problem: { code: string; reason: string },
  ): Promise<ActivateResult> {
    const mark = refusalMarker(label, problem.code);
    const existing = await this.ports.comments(result.issue);
    const refused: ActivateResult = {
      ...result,
      reason: problem.reason,
      refusalPosted: false,
    };
    if (!existing.some((c) => c.body.includes(mark))) {
      refused.commentUrl = await this.ports.comment(
        result.issue,
        `${mark}\n### Refused to change guardrail \`${result.rule}\`\n\n${problem.reason}\n\nThe mode is unchanged.`,
      );
      refused.refusalPosted = true;
    }
    return refused;
  }

  /** Changes the mode only on approval; every refusal leaves the inventory and the ledger as they were. */
  async activate(input: { rule: string; to: string }): Promise<ActivateResult> {
    const { guardrail, issue } = this.check(input);
    const label = requestLabel(input.rule, guardrail.mode, input.to);
    const result: ActivateResult = {
      rule: input.rule,
      from: guardrail.mode,
      to: input.to,
      idea: this.ports.idea.number,
      issue,
      activated: false,
    };
    const found = await this.approval(label, input.rule, input.to, issue);
    if ("problem" in found) {
      return this.refuse(result, label, found.problem);
    }
    const warning = senderWarning(label, found.approver);
    if (warning !== undefined) {
      const warned = await this.ports.recordWarning(
        label,
        this.ports.idea.number,
      );
      if (!warned.ok) {
        throw new GuardrailError(
          `The sender-line warning for ${label} could not be recorded: ${warned.message}. Record it with \`harness ledger record --kind guardrail.approval-warned --label ${label} --idea ${this.ports.idea.number}\`, then rerun.`,
        );
      }
    }
    const text =
      input.to === "removed"
        ? withoutRule(this.ports.inventoryText, input.rule)
        : withMode(this.ports.inventoryText, input.rule, input.to);
    const changed = parseInventory(text);
    await this.ports.writeInventory(text);
    if (guardrail.deny !== undefined) {
      await this.ports.syncDeny(changed);
    }
    const written = await this.ports.recordEvent(label, this.ports.idea.number);
    if (!written.ok) {
      throw new GuardrailError(
        `${input.rule} is now in ${input.to} mode, but its ledger event was rejected: ${written.message}. Record it with \`harness ledger record --kind guardrail.activated --label ${label} --idea ${this.ports.idea.number}\`.`,
      );
    }
    return {
      ...result,
      activated: true,
      ...(warning === undefined ? {} : { warning }),
    };
  }
}
