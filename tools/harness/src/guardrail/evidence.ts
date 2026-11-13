// Where a guardrail's outcome evidence comes from, by kind and mode (ADR 0080).
// A rule with no source is refused: all-zero figures would look measured when
// nothing measured them.
import type { Guardrail } from "./inventory.js";

/** The measure that exists for a rule today. */
export type EvidenceSource = "warnings" | "blocks" | "ruleset-insights";

/** The evidence source for a rule, or the reason it has none and what to use instead. */
export function evidenceSource(
  guardrail: Guardrail,
): { source: EvidenceSource } | { refusal: string } {
  const { rule, kind, mode, deny } = guardrail;
  if (kind === "ruleset") {
    return mode === "audit"
      ? { source: "ruleset-insights" }
      : {
          refusal: `${rule} is an enforced ruleset rule, and \`harness ruleset insights\` measures only what the evaluate-mode candidate ruleset would have blocked (ADR 0090). Instead, put the rule back in audit so the candidate ruleset measures it, then request again.`,
        };
  }
  if (deny !== undefined && mode === "enforce") {
    return {
      refusal: `${rule} is an enforced deny rule: a settings deny blocks before any guard runs, so nothing counts its blocks. Instead, put the rule in audit (the guard then warns, and the retro scan counts it), or judge it from the session transcripts by hand.`,
    };
  }
  return { source: mode === "audit" ? "warnings" : "blocks" };
}
