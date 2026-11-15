// The judge's checklist: each item reads its mode from the guardrail inventory.
// An enforce item that fails sends the change back; an audit item that fails is
// reported and never does (ADR 0080, AGENTS.md "Audit before enforce").
import { modeOf, type Inventory, type Mode } from "../guardrail/index.js";
import type { Check, ItemVerdict } from "./checks.js";
import { JudgeError } from "./errors.js";
import type { Report } from "./precheck.js";

export const ITEMS = [
  "ci",
  "scan",
  "coverage",
  "principles-review",
  "expand-step",
  "pattern-match",
  "guardrail-activation",
] as const;
export type Item = (typeof ITEMS)[number];

export type ItemModes = Readonly<Record<Item, Mode>>;

/** The inventory rule an item's mode is read from. */
export const ruleOf = (item: Item): string => `judge-${item}`;

/** What the precheck found for each item; the expand step only when the diff needed one. */
export type Findings = Readonly<
  { [I in Exclude<Item, "expand-step" | "guardrail-activation">]: Check } & {
    "expand-step"?: Check;
    "guardrail-activation"?: Check;
  }
>;

export interface Checklist {
  /** False only when an enforce item did not pass: the change goes back. */
  ok: boolean;
  items: ItemVerdict[];
  /** The audit items that did not pass: reported, and each one a ledger event. */
  audited: ItemVerdict[];
}

export function evaluateChecklist(
  findings: Findings,
  modes: ItemModes,
): Checklist {
  const items = ITEMS.flatMap((item): ItemVerdict[] => {
    const found = findings[item];
    return found === undefined
      ? []
      : [
          {
            item,
            rule: ruleOf(item),
            mode: modes[item],
            result: found.result,
            ...(found.detail === undefined ? {} : { detail: found.detail }),
          },
        ];
  });
  const failing = items.filter((i) => i.result !== "pass");
  return {
    ok: !failing.some((i) => i.mode === "enforce"),
    items,
    audited: failing.filter((i) => i.mode === "audit"),
  };
}

/** Each item's mode from the inventory; a mode that is not audit or enforce is refused, never read as enforce. */
export function modesFrom(inventory: Inventory): ItemModes {
  return Object.fromEntries(
    ITEMS.map((item) => {
      const mode = modeOf(inventory, ruleOf(item));
      if (mode !== "audit" && mode !== "enforce") {
        throw new JudgeError(
          `${ruleOf(item)} has the mode "${String(mode)}" in .claude/guardrails.yaml. Set it to audit or enforce, then rerun.`,
        );
      }
      return [item, mode];
    }),
  ) as ItemModes;
}

/**
 * The guardrail-activation check: every change that lands a guardrail in enforce, loosens it
 * or removes it needs a guardrail.activated event, written only by `guardrail activate` on a
 * person's approval. A new guardrail has no such event, so it must start in audit.
 */
function activationCheck(
  changes: readonly string[],
  activated: ReadonlySet<string>,
): Check {
  const missing = changes.filter((change) => !activated.has(change));
  return missing.length === 0
    ? { result: "pass" }
    : {
        result: "fail",
        detail: `${missing.join(", ")} has no guardrail.activated event; run \`harness guardrail request\` and \`harness guardrail activate\`, or land it in audit`,
      };
}

/**
 * The report under the modes: an item that fails in enforce mode makes it not ready; one
 * that fails in audit mode is listed under `audited` and changes nothing else. A report
 * that stopped at its declaration has no items and is returned as it is.
 */
export function applyChecklist(
  report: Report,
  modes: ItemModes,
  activated: ReadonlySet<string> = new Set(),
): Report {
  const { checks } = report;
  if (checks === undefined) {
    return report;
  }
  const checklist = evaluateChecklist(
    {
      ci: checks.ci,
      scan: checks.scan,
      coverage: checks.coverage,
      "principles-review": checks.principlesReview,
      ...(checks.expandStep === undefined
        ? {}
        : { "expand-step": checks.expandStep }),
      "pattern-match":
        report.patternMatches === true
          ? { result: "pass" }
          : { result: "fail", detail: report.patternMismatch ?? "" },
      ...(report.guardrailChanges === undefined
        ? {}
        : {
            "guardrail-activation": activationCheck(
              report.guardrailChanges,
              activated,
            ),
          }),
    },
    modes,
  );
  return {
    ...report,
    ok: checklist.ok,
    checklist: checklist.items,
    audited: checklist.audited,
  };
}
