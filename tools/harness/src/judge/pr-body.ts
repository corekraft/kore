import { PATTERNS } from "./declaration.js";
import { JudgeError } from "./errors.js";

export interface PrBodyInput {
  /** The writer's summary; the declaration lines follow it. */
  body: string;
  pattern: string;
  /** The issue the PR links: written as `Refs #n`, or `Closes #n` when `closes` is set. */
  issue?: number;
  closes?: boolean;
  idea?: string;
  /**
   * The merged expand PR a contract names, or `none` for an expand step, which names no earlier
   * expand PR and so writes no `Expand step:` line.
   */
  expandStep?: number | "none";
}

export interface PrBody {
  body: string;
  warnings: string[];
}

/**
 * Renders a PR body whose declaration `parseDeclaration` and `auditDeclaration` accept:
 * the `Safety pattern:` line comes last. It refuses what the precheck would refuse, so a
 * PR is never created half-declared. `closes` with an idea warns instead (ADR 0079, 0097).
 */
export function renderPrBody(input: PrBodyInput): PrBody {
  const { pattern, expandStep } = input;
  if (!(PATTERNS as readonly string[]).includes(pattern)) {
    throw new JudgeError(
      `Unknown safety pattern "${pattern}". Pass --pattern with one of ${PATTERNS.join(", ")}.`,
    );
  }
  if (pattern === "expand-contract" && expandStep === undefined) {
    throw new JudgeError(
      "An expand-contract PR names its merged expand step. Pass --expand-step <PR number> for the merged expand PR, or --expand-step none when this PR is the expand step.",
    );
  }
  if (pattern !== "expand-contract" && expandStep !== undefined) {
    throw new JudgeError(
      `--expand-step applies only to expand-contract, but the pattern is ${pattern}. Drop --expand-step or pass --pattern expand-contract.`,
    );
  }
  const warnings: string[] = [];
  if (input.closes === true && input.idea !== undefined) {
    warnings.push(
      "Closes with an Idea line: an idea's outcome closes on recorded proof, not on merge (ADR 0079, ADR 0097). Use Refs unless this merge itself delivers the issue.",
    );
  }
  const keyword = input.closes === true ? "Closes" : "Refs";
  const lines = [
    input.issue === undefined ? undefined : `${keyword} #${input.issue}`,
    input.idea === undefined ? undefined : `Idea: ${input.idea}`,
    expandStep === undefined || expandStep === "none"
      ? undefined
      : `Expand step: #${expandStep}`,
    `Safety pattern: ${pattern}`,
  ].filter((line): line is string => line !== undefined);
  const summary = input.body.trim();
  const declaration = lines.join("\n");
  return {
    body: `${summary === "" ? "" : `${summary}\n\n`}${declaration}\n`,
    warnings,
  };
}
