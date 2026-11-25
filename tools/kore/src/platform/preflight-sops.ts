import { isAgeRecipient, type Repository } from "../config/index.js";
import type { MissingPrerequisite } from "./preflight-message.js";

// Docs: docs/decisions/0147-vps-v1-is-every-applicable-flag-proven-live-one-per-run-from-release-locks.md

/**
 * The vps sops recipient and its creation rule, read from `.sops.yaml` by
 * `loadRepository`. Missing when no creation rule covers the environment's
 * secrets, or when a recipient it names is not an age public key (a placeholder
 * the owner has not replaced). Reads no file and runs no command.
 */
export function sopsProblems(repository: Repository): MissingPrerequisite[] {
  const name = repository.environment.name;
  const path = `infra/environments/${name}/secrets`;
  const recipients = repository.sopsRecipients;
  if (recipients === undefined || recipients.length === 0) {
    return [
      {
        name: "sops recipient",
        problem: `.sops.yaml has no creation rule for ${path} that names an age recipient`,
        fix: `add a creation rule for ${path}/ naming the ${name} age recipient to .sops.yaml`,
      },
    ];
  }
  const invalid = recipients.filter((recipient) => !isAgeRecipient(recipient));
  if (invalid.length === 0) {
    return [];
  }
  return [
    {
      name: "sops recipient",
      problem: `the creation rule for ${path} names ${invalid.length} recipient${invalid.length === 1 ? "" : "s"} that ${invalid.length === 1 ? "is" : "are"} not an age public key`,
      fix: `replace the placeholder with the ${name} age public key in the creation rule in .sops.yaml`,
    },
  ];
}
