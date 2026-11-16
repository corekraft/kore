// A request for a person to approve changing a guardrail's mode: one comment on
// the idea's issue with the idea link and four figures, and one ledger event.
// A request never changes a mode; `guardrail activate` is a later step.
// Plan: infra/plans/12-self-improving-loop.md (Step 4).

import { signedBody } from "../sender/index.js";
import { requestEvidence, type Evidence } from "./evidence.js";
import { GuardrailError, INVENTORY_PATH, type Inventory } from "./inventory.js";

export type Target = "enforce" | "audit" | "removed";
const TARGETS: readonly string[] = ["enforce", "audit", "removed"];

export interface RequestPorts {
  inventory: Inventory;
  idea: { number: string; title: string; path: string; issue?: string };
  /** `owner/name`, for the idea link. */
  repo: string;
  /** The labels of the guardrail.requested events already recorded. */
  events(): Promise<{ label?: string }[]>;
  recordEvent(
    label: string,
    idea: string,
  ): Promise<{ ok: true } | { ok: false; message: string }>;
  comments(issue: string): Promise<string[]>;
  comment(issue: string, body: string): Promise<string>;
  /** The environment the request runs in; it names the sender on the comment's first line. */
  env: Readonly<Record<string, string | undefined>>;
}

export interface RequestInput {
  rule: string;
  to: string;
  falsePositives: number;
  scan: unknown;
}

export interface RequestResult {
  rule: string;
  from: "audit" | "enforce";
  to: Target;
  idea: string;
  issue: string;
  evidence: Evidence;
  posted: boolean;
  recorded: boolean;
  commentUrl?: string;
}

/** The ledger label of one change to one rule; also the comment's marker. */
export const requestLabel = (rule: string, from: string, to: string): string =>
  `${rule}:${from}>${to}`;

export const marker = (label: string): string =>
  `<!-- guardrail-request: ${label} -->`;

const figure = (value: number | null): string =>
  value === null ? "not measured" : String(value);

const VERB: Record<Target, string> = {
  enforce: "enforce",
  audit: "loosen",
  removed: "remove",
};

function body(
  input: { rule: string; from: string; to: Target; label: string },
  idea: RequestPorts["idea"],
  repo: string,
  evidence: Evidence,
): string {
  const lines = [
    marker(input.label),
    `### Request to ${VERB[input.to]} guardrail \`${input.rule}\``,
    "",
    `Change: ${input.from} to ${input.to}`,
    `Idea: https://github.com/${repo}/blob/main/${idea.path} (${idea.title})`,
    "",
    `- Fired: ${evidence.fired}`,
    `- Heeded: ${figure(evidence.heeded)}`,
    `- Overridden: ${figure(evidence.overridden)}`,
    `- False positives: ${evidence.falsePositives}`,
  ];
  if (evidence.classification !== null) {
    lines.push(`- Classification: ${evidence.classification}`);
  }
  lines.push("", "A person approves this. The request changes no mode.");
  return lines.join("\n");
}

/** Files approval requests; every port is injected, so nothing here touches GitHub or disk. */
export class GuardrailRequest {
  constructor(private readonly ports: RequestPorts) {}

  private check(input: RequestInput) {
    const { idea } = this.ports;
    const found = this.ports.inventory.guardrails.find(
      (g) => g.rule === input.rule,
    );
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
        `Idea ${idea.number} has no issue, so there is nowhere to ask for approval. Open one with \`harness idea sync\`, then rerun.`,
      );
    }
    return { from: found.mode, to: input.to as Target, issue: idea.issue };
  }

  /**
   * Posts the request once and records it. Everything is checked before the
   * first write; a rerun finds the ledger event, or the comment's marker, and
   * does not post again.
   */
  async request(input: RequestInput): Promise<RequestResult> {
    const { from, to, issue } = this.check(input);
    const { idea } = this.ports;
    const evidence = requestEvidence(
      input.scan,
      input.rule,
      from,
      input.falsePositives,
    );
    const label = requestLabel(input.rule, from, to);
    const result: RequestResult = {
      rule: input.rule,
      from,
      to,
      idea: idea.number,
      issue,
      evidence,
      posted: false,
      recorded: false,
    };
    if ((await this.ports.events()).some((e) => e.label === label)) {
      return result;
    }
    const existing = await this.ports.comments(issue);
    if (!existing.some((text) => text.includes(marker(label)))) {
      const signed = signedBody(
        this.ports.env,
        "guardrail request",
        body(
          { rule: input.rule, from, to, label },
          idea,
          this.ports.repo,
          evidence,
        ),
      );
      if ("error" in signed) {
        throw new GuardrailError(signed.error);
      }
      result.commentUrl = await this.ports.comment(issue, signed.body);
      result.posted = true;
    }
    const written = await this.ports.recordEvent(label, idea.number);
    if (!written.ok) {
      throw new GuardrailError(
        `The request was posted, but its ledger event was rejected: ${written.message}. Fix the ledger, then rerun the same command; it will not post again.`,
      );
    }
    result.recorded = true;
    return result;
  }
}
