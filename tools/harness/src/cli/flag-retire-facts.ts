// The facts a flag's retirement is judged on, read from the overlays, the idea records and the ledger (ADR 0149). Split out of flag-retire-command.ts to keep each module within the lint cap.

import { IdeaRepository } from "../idea/index.js";
import {
  environments,
  readOverlay,
  recordedProofs,
  retirementEnvironments,
  type ManifestEntry,
  type ReleaseLock,
  type RetireEnvironment,
  type RetireFacts,
} from "../flag/index.js";
import type { Ledger, LedgerEvent } from "../ledger/index.js";
import type { Clock, FileSystem } from "../runtime/index.js";
import { readRetireSoakDays } from "./flag-retire-soak.js";

/** The ledger kinds that stop a soak: a revert of main, or of a harness change (ADR 0149). */
const REVERT_KINDS = ["main.revert", "harness-change-reverted"] as const;

export interface RetireFactsInput {
  fs: FileSystem;
  clock: Clock;
  base: string;
  ledger: Ledger;
  release: ReleaseLock | undefined;
  flag: string;
  entry: ManifestEntry | undefined;
}

/** When the latest event with this label was recorded, or undefined when none carries it. */
function latestAt(events: LedgerEvent[], label: string): string | undefined {
  let latest: string | undefined;
  for (const event of events) {
    if (
      event.label === label &&
      (latest === undefined ||
        Date.parse(event.occurredAt) > Date.parse(latest))
    ) {
      latest = event.occurredAt;
    }
  }
  return latest;
}

/** One applicable environment's state: its overlay, its recorded outcome, and its latest activation. */
async function environmentFacts(
  input: RetireFactsInput,
  name: string,
  present: string[],
  activations: LedgerEvent[],
): Promise<RetireEnvironment> {
  const { fs, base, flag } = input;
  const activated = latestAt(activations, `${flag}@${name}`);
  if (!present.includes(name)) {
    return { name, hasOverlay: false, on: false, proven: false, activated };
  }
  const overlay = await readOverlay(fs, base, name);
  const proofs = await recordedProofs(
    new IdeaRepository(fs, input.clock, base),
    name,
    input.release,
    overlay.production === true,
  );
  return {
    name,
    hasOverlay: true,
    on: overlay.features[flag] === true,
    proven: proofs.has(flag),
    activated,
  };
}

/** Everything the retirement rule reads about a flag, gathered once; no file or ledger is written. */
export async function retireFactsOf(
  input: RetireFactsInput,
): Promise<RetireFacts> {
  const { ledger, clock, entry, flag } = input;
  const soakDays = await readRetireSoakDays(input.fs, input.base);
  const activations = (await ledger.list({ kind: "flag.activated" })).events;
  const present = await environments(input.fs, input.base);
  const names = entry === undefined ? [] : retirementEnvironments(entry);
  const environmentStates: RetireEnvironment[] = [];
  for (const name of names) {
    environmentStates.push(
      await environmentFacts(input, name, present, activations),
    );
  }
  const reverts: string[] = [];
  for (const kind of REVERT_KINDS) {
    const found = await ledger.list({ kind });
    reverts.push(...found.events.map((event) => event.occurredAt));
  }
  return {
    flag,
    entry,
    environments: environmentStates,
    reverts,
    soakDays,
    now: clock.now(),
  };
}
