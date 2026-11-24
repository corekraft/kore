import type { CommandHelp } from "../runtime/index.js";

// Docs: docs/decisions/0150-platform-releases-reach-vps-by-a-recorded-rollout-and-roll-back-by-revert.md

/** The help record for `platform rollout-record`. */
export const recordHelp: CommandHelp = {
  purpose:
    "Records that a release was rolled out to an environment: one platform.rolled-out ledger event naming the environment, the release tag, the sha256 of the release chart lock and image lock, and each chart's name, version and entry digest from the chart lock. It refuses, and writes nothing, unless every authorizedSigner of both locks is release.yaml at refs/tags/<tag>, so a main lock is never recorded as a rollout.",
  when: "Once, after `kore platform up --environment <env>` succeeded from the release's locks, to make the rollout the last good one that harness platform rollout-drift compares with.",
  whenNot:
    "To check whether the cluster still matches the last rollout: use platform rollout-drift. Never to record a rollout that failed or was only a local proof: the record is the last good rollout (ADR 0150). The ledger holds no hand-typed rollout; ledger record refuses the kind.",
  flags: {
    environment:
      "The environment that was rolled out, such as vps. Required: the command never picks one for you.",
    tag: "The release tag the locks belong to, such as v1.4.0. Required.",
    "chart-lock":
      "The release's platform-charts.lock.json, as passed to kore platform up. A relative path is read from the repository root. Required.",
    "image-lock":
      "The release's platform-images.lock.json. A relative path is read from the repository root. Required.",
    ledger:
      "The ledger file the event is recorded in, relative to the working directory; by default the shared ledger of the main checkout.",
  },
  examples: [
    {
      command:
        "harness platform rollout-record --environment vps --tag v1.4.0 --chart-lock platform-charts.lock.json --image-lock platform-images.lock.json",
      shows:
        "one line naming vps, v1.4.0, the chart count and the chart lock digest, and one event in the ledger",
    },
    {
      command:
        "harness platform rollout-record --environment vps --tag v1.4.0 --chart-lock main-charts.lock.json --image-lock platform-images.lock.json",
      shows:
        "a refusal naming the chart lock and its signer, exit 1, and nothing written",
    },
  ],
  exits: [
    { code: 0, meaning: "the rollout is recorded" },
    {
      code: 1,
      meaning:
        "refused and nothing written: a missing flag, an unreadable or malformed lock, a lock not signed only by release.yaml at the tag, or a ledger that cannot be opened or rejects the event",
    },
    {
      code: 2,
      meaning: "a flag the command does not declare, or a flag with no value",
    },
  ],
  effects: {
    kind: "mutates",
    detail:
      "appends one platform.rolled-out event to the ledger; reads the two lock files; touches no cluster",
  },
  seeAlso: ["platform rollout-drift"],
};

/** The help record for `platform rollout-drift`. */
export const driftHelp: CommandHelp = {
  purpose:
    "Compares the last platform.rolled-out event recorded for an environment with the cluster's installed charts, read from `kore platform status --environment <env> --json`, and names each chart whose installed name or version differs. It says plainly when no rollout is recorded, and when no recorded chart has a Helm release row to compare with, instead of reporting no drift.",
  when: "To check a managed environment against its last good rollout, such as before a rollout or after a failed one (ADR 0150).",
  whenNot:
    "To roll anything out or back: nothing here changes a cluster, and a rollback is a revert and a rollout run. To record a rollout: use platform rollout-record.",
  flags: {
    environment:
      "The environment whose last rollout to compare, such as vps. Required.",
    status:
      "A file holding the output of `kore platform status --environment <env> --json`; by default the same text is read from stdin. A relative path is read from the repository root.",
    ledger:
      "The ledger file the rollout is read from, relative to the working directory; by default the shared ledger of the main checkout.",
  },
  examples: [
    {
      command:
        "kore platform status --environment vps --json | harness platform rollout-drift --environment vps",
      shows:
        "No drift: and the compared chart count, or one line per chart whose installed version differs from the recorded one",
    },
    {
      command:
        "harness platform rollout-drift --environment vps --status vps-status.json",
      shows: "the same comparison from a saved status file",
    },
  ],
  exits: [
    {
      code: 0,
      meaning: "at least one recorded chart was compared and none differs",
    },
    {
      code: 1,
      meaning:
        "a difference, no recorded rollout for the environment, nothing comparable, a missing flag, or a status that is not the status JSON",
    },
    {
      code: 2,
      meaning: "a flag the command does not declare, or a flag with no value",
    },
  ],
  effects: {
    kind: "read-only",
    detail:
      "reads the ledger and the status text; writes nothing and touches no cluster, since the status is produced by a separate read-only kore command",
  },
  seeAlso: ["platform rollout-record"],
};
