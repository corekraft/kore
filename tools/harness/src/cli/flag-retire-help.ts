// Docs: docs/decisions/0149-a-feature-flag-retires-after-it-soaks-on-in-every-environment-it-applies-to.md

import type { CommandHelp } from "../runtime/index.js";

/** The help record for `flag retire`: removes a soaked feature flag, and only a soaked one. */
export const retireHelp: CommandHelp = {
  purpose:
    "Retires a feature flag that has soaked on in every environment it applies to: removes it from every environment overlay that declares it and from the flag manifest, records one flag.retired ledger event, and prints every remaining reference to the flag's name for the writer to delete. A flag is eligible when it is a feature flag on in every environment its manifest entry lists, each with its own recorded outcome, and its soak has elapsed since the latest activation with no revert in that window. The soak is configured by retireSoakDays in .claude/harness.json, in whole days (ADR 0149). An ineligible flag is refused with every reason, and nothing is written.",
  when: "At horizon:then, for a feature flag that has been on and proven in every environment it applies to for the whole soak, so the flag, its off path and their tests can be deleted in one contract-step pull request.",
  whenNot:
    "To turn a flag on: use flag activate. To see which flags are on and what proves them: use flag progress or flag audit. An environment or harness flag is never retired. The recorded outcomes and the ledger are never removed: they are append-only.",
  flags: {
    "chart-lock":
      "The release's platform-charts.lock.json: a main-lock live run counts only when its charts equal this lock, as activation requires. A relative path is read from the repository root.",
    ledger:
      "The ledger file the flag.retired event and the activations are read from and recorded in, relative to the working directory; by default the shared ledger of the main checkout.",
  },
  operand:
    "The feature flag to retire, as declared in the flag manifest (infra/catalog/flags.yaml).",
  examples: [
    {
      command: "harness flag retire suborg-tenancy",
      shows:
        "with the flag not yet soaked, or on in an environment without a recorded outcome, the command exits 1 naming each reason and changes nothing",
    },
    {
      command: "harness flag retire suborg-tenancy --json",
      shows:
        "once the flag is eligible, the retirement as one JSON object: the overlays and the manifest it rewrote, and the remaining references to delete",
    },
  ],
  exits: [
    {
      code: 0,
      meaning:
        "the flag is retired: its overlay and manifest entries are removed, the flag.retired event is recorded, and the remaining references are printed",
    },
    {
      code: 1,
      meaning:
        "refused and nothing is written: a missing flag name, a flag the manifest does not declare or that is not a feature flag, a flag that is off, unproven, unactivated or reverted in an environment it applies to, a soak that has not elapsed, a harness config that does not set retireSoakDays or cannot be read, a ledger that cannot be opened, or a search of the checkout that cannot run. The ledger event is rejected only after the files are written, which the pre-write check makes unlikely; the reason is named",
    },
  ],
  effects: {
    kind: "mutates",
    detail:
      "when eligible, rewrites each environment overlay that declares the flag and infra/catalog/flags.yaml without the flag's entries, and appends one flag.retired event to the ledger; reads the overlays, the manifest, the idea records, the ledger and the tracked files to print the remaining references. A refused run writes nothing",
  },
  seeAlso: ["flag activate", "flag progress", "flag audit"],
};
