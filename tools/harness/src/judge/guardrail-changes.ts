// The inventory changes a PR makes that need a person's approval on record: a rule landing in
// enforce, a rule loosened, a rule removed. The judge's guardrail-activation item looks each up
// among the guardrail.activated events. Plan: infra/plans/12-self-improving-loop.md (Step 4).
import {
  GuardrailError,
  INVENTORY_PATH,
  parseInventory,
  type Inventory,
} from "../guardrail/index.js";
import type { ChangedFile } from "./diff.js";
import { JudgeError } from "./errors.js";
import type { Api } from "./manifest-source.js";

function read(text: string, side: string): Inventory {
  try {
    return parseInventory(text);
  } catch (error) {
    if (error instanceof GuardrailError) {
      throw new JudgeError(
        `The ${side} guardrail inventory cannot be read: ${error.message} Fix ${INVENTORY_PATH} in the PR, then rerun.`,
      );
    }
    throw error;
  }
}

/**
 * Each `rule:from>to` change that needs an activation. A rule new in the diff has the
 * from-mode "new", which no activation event can have, so a new rule must start in audit.
 */
export function guardrailChanges(before: string, after: string): string[] {
  const was = new Map(
    read(before, "base").guardrails.map((g) => [g.rule, g.mode]),
  );
  const now = new Map(
    read(after, "head").guardrails.map((g) => [g.rule, g.mode]),
  );
  const changes = [...now].flatMap(([rule, mode]) => {
    const from = was.get(rule);
    if (from === mode || (from === undefined && mode === "audit")) {
      return [];
    }
    return [`${rule}:${from ?? "new"}>${mode}`];
  });
  const removed = [...was]
    .filter(([rule]) => !now.has(rule))
    .map(([rule, mode]) => `${rule}:${mode}>removed`);
  return [...changes, ...removed];
}

const RAW = ["api", "-H", "Accept: application/vnd.github.raw"] as const;

/**
 * The changes the PR's diff makes to the inventory, read at the merge base and at the head;
 * undefined when the diff leaves the inventory alone.
 */
export async function gatherGuardrailChanges(
  files: readonly ChangedFile[],
  api: Api,
  repo: string,
  baseSha: string,
  headSha: string,
): Promise<string[] | undefined> {
  if (!files.some((f) => f.path === INVENTORY_PATH && !f.deleted)) {
    return undefined;
  }
  const mergeBase = (
    await api([
      "api",
      `repos/${repo}/compare/${baseSha}...${headSha}`,
      "--jq",
      ".merge_base_commit.sha",
    ])
  ).trim();
  const at = (ref: string) =>
    api([...RAW, `repos/${repo}/contents/${INVENTORY_PATH}?ref=${ref}`]);
  return guardrailChanges(await at(mergeBase), await at(headSha));
}
