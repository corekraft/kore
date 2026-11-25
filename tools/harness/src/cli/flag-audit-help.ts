// The help record for `harness flag audit`, kept beside the vps audit it documents.
import type { CommandHelp } from "../runtime/index.js";

/** The help record for `flag audit`: fails on any flag that is on without recorded proof. */
export const auditHelp: CommandHelp = {
  purpose:
    "Checks every flag that is on in any environment overlay for its recorded proof. It fails when a flag is on with no confirmed verification outcome, from a live run or an owner waiver, and names each flag that rests on a waiver rather than a live run. kb-check reports the same flags as warnings (ADR 0080).",
  when: "Before a release, or when kb-check warns about a flag, to find flags that are on without proof.",
  whenNot:
    "To turn a flag on: use flag activate, which refuses without proof. To read the recorded outcome itself: use idea show for the idea that holds it.",
  flags: {
    vps: "The vps-limited audit: every flag that is on in the vps overlay with no live-run outcome. An owner waiver does not count. Its mode is the vps-flag-proof guardrail's: in audit mode each flag is a warning and the command exits 0; in enforce mode it exits 1.",
  },
  examples: [
    {
      command: "harness flag audit",
      shows:
        "Flag audit passed: no flag is on without proof, with a line for each flag that rests on an owner waiver",
    },
    {
      command: "harness flag audit --vps",
      shows:
        "warning lines on stderr, each naming a true vps flag with no live-run outcome and the fix, with exit 0 while vps-flag-proof is in audit",
    },
    {
      command: "harness flag audit --json",
      shows:
        "unproven and waived as one JSON object: on stdout when the audit passes, on stderr with exit 1 when it fails",
    },
  ],
  exits: [
    {
      code: 0,
      meaning:
        "no flag is on without proof; a flag under an owner waiver is listed and does not fail. With --vps, also when a vps flag lacks a live run while vps-flag-proof is in audit mode",
    },
    {
      code: 1,
      meaning:
        "at least one flag is on with no verification outcome; each is named on stderr with the step to fix it. With --vps, also when a vps flag lacks a live run and vps-flag-proof is in enforce mode",
    },
    {
      code: 2,
      meaning: "a flag the command does not declare",
    },
  ],
  effects: {
    kind: "read-only",
    detail:
      "reads each environment overlay, the idea records and the guardrail inventory; writes nothing",
  },
  seeAlso: ["flag activate", "idea show", "guardrail status"],
};
