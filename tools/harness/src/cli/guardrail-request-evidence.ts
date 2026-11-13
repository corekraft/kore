// Gathers the outcome evidence a guardrail request presents, from the source
// that measures that kind of rule (ADR 0080, ADR 0090).
import {
  ModeHistory,
  type Evidence,
  type EvidenceSource,
  type Guardrail,
} from "../guardrail/index.js";
import { ruleEvidence } from "../hook/index.js";
import { RulesetError, ruleFirings } from "../ruleset/index.js";
import type { CommandContext } from "../runtime/index.js";

function text(options: CommandContext["options"], key: string) {
  const value = options[key];
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

/** Where the transcript window opens, and why: --since, else when the rule entered its mode, else the last retrospective. */
async function window(
  { deps, options }: CommandContext,
  guardrail: Guardrail,
): Promise<{ since: string | undefined; why: string }> {
  const given = text(options, "since");
  if (given !== undefined) {
    return { since: given, why: `since ${given}, from --since` };
  }
  const history = new ModeHistory(deps.runner, await deps.root());
  const entered = await history.enteredMode(guardrail.rule, guardrail.mode);
  if (entered !== undefined) {
    return {
      since: entered,
      why: `since ${entered}, when the rule entered ${guardrail.mode} mode`,
    };
  }
  return {
    since: undefined,
    why: text(options, "dir")
      ? "all sessions in --dir; git history gave no mode date"
      : "since the last retrospective; git history gave no mode date",
  };
}

function required(context: CommandContext, key: string, meaning: string) {
  const value = text(context.options, key);
  if (value === undefined) {
    throw new RulesetError(
      `Missing --${key}: a ruleset rule's evidence names its ${meaning} explicitly. Rerun with --${key} <value>.`,
    );
  }
  return value;
}

export async function gatherEvidence(
  context: CommandContext,
  guardrail: Guardrail,
  source: EvidenceSource,
): Promise<Evidence> {
  const { deps, options } = context;
  if (source === "ruleset-insights") {
    const timePeriod = text(options, "time-period") ?? "week";
    const found = await ruleFirings(deps.runner, {
      repo: required(context, "repo", "repository, as owner/name"),
      target: required(context, "target", "ruleset, by name"),
      rule: guardrail.rule,
      timePeriod,
    });
    return {
      source,
      window: `last ${timePeriod}`,
      ruleset: found.ruleset,
      timePeriod,
      suites: found.suites,
      firings: found.firings,
      truncated: found.truncated,
    };
  }
  const { since, why } = await window(context, guardrail);
  const { row, blocks } = await ruleEvidence(deps, guardrail.rule, {
    dir: text(options, "dir"),
    since,
  });
  return source === "blocks"
    ? { source, window: why, blocks }
    : {
        source,
        window: why,
        status: row.status,
        fired: row.warnings,
        heeded: row.heeded,
        overridden: row.overridden,
        repeated: row.repeated,
        unresolved: row.unresolved,
      };
}
