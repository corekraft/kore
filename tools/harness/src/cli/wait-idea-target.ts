// The idea side of `harness wait --idea <name>` and `--any-idea` (#1033): reads the main checkout's
// ledger once and settles on the first idea state that changed after the wait began. It reads
// the ledger only; the states come from ledger/idea-state.ts, and no event is recorded.
// Docs: docs/guides/contributor.md

import { join } from "node:path";
import {
  DEFAULT_LEDGER,
  Ledger,
  firstIdeaStateChange,
  isName,
} from "../ledger/index.js";
import { mainRoot, type CliDeps } from "../runtime/index.js";

/** What an idea target waits on: one named idea, or any idea when the name is undefined. */
export interface IdeaWaitTarget {
  readonly idea: string | undefined;
}

/**
 * The waits the --idea names and --any-idea give, in the order named, or the usage to refuse
 * with: the two flags together name different waits, and a name the ledger would refuse is not
 * an idea. No names and no --any-idea give no waits.
 */
export function ideaWaits(
  names: readonly string[],
  anyIdea: boolean,
): { waits: IdeaWaitTarget[] } | { usage: string } {
  if (anyIdea && names.length > 0) {
    return {
      usage:
        "Give either --idea <name> or --any-idea, not both: --idea waits on one idea, --any-idea on any.",
    };
  }
  if (anyIdea) {
    return { waits: [{ idea: undefined }] };
  }
  const bad: string | undefined = names.find((name) => !isName(name));
  if (bad !== undefined) {
    return {
      usage: `Invalid --idea "${String(bad)}": give an idea name, such as --idea 0007 or --idea #7.`,
    };
  }
  return { waits: names.map((idea) => ({ idea })) };
}

/** One read of the ledger: still pending, or settled on the idea that changed and its new state. */
export type IdeaRead =
  { kind: "pending" } | { kind: "settled"; idea: string; state: string };

/** Reads the ledger once; settles on the first change at or after `since` to the target's idea. */
export async function readIdeaTarget(
  deps: CliDeps,
  target: IdeaWaitTarget,
  since: string,
): Promise<IdeaRead> {
  const main = (await mainRoot(deps)) ?? (await deps.root());
  const ledger = new Ledger(
    deps.fs,
    deps.clock,
    deps.ids,
    join(main, DEFAULT_LEDGER),
  );
  const listed = await ledger.list({});
  const change = firstIdeaStateChange(listed.events, since, target.idea);
  return change === undefined
    ? { kind: "pending" }
    : { kind: "settled", idea: change.idea, state: change.state };
}
