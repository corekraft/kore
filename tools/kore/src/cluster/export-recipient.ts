import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  environmentRecipients,
  isAgeRecipient,
  PLACEHOLDER_RECIPIENT,
  type Repository,
} from "../config/index.js";

export { isAgeRecipient, PLACEHOLDER_RECIPIENT };

/** Each entry is checked alone, so one bad entry is named, never the whole list. */
function checkRecipient(entry: string, name: string): void {
  if (entry === PLACEHOLDER_RECIPIENT) {
    throw new Error(
      `the age recipient in .sops.yaml for ${name} is still the placeholder ${PLACEHOLDER_RECIPIENT}; set it to the public age recipient (age1...) you generated, then retry`,
    );
  }
  if (!isAgeRecipient(entry)) {
    throw new Error(
      `"${entry}" in .sops.yaml is not a valid age recipient (expected age1 followed by 58 characters); set the public recipient printed by age-keygen`,
    );
  }
}

/**
 * Reads the age recipients that `.sops.yaml` names for this environment's
 * secrets, a comma-separated list of public keys. Every entry is checked, and
 * the export encrypts to all of them. No key material is read.
 */
export async function exportRecipients(
  repository: Repository,
): Promise<string[]> {
  const name = repository.environment.name;
  let text: string;
  try {
    text = await readFile(join(repository.root, ".sops.yaml"), "utf8");
  } catch (error) {
    throw new Error(
      `cannot read .sops.yaml for the age recipient: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const recipients = environmentRecipients(text, name);
  if (recipients === undefined) {
    throw new Error(
      `.sops.yaml has no creation rule with an age recipient for environments/${name}/; add one before exporting`,
    );
  }
  for (const recipient of recipients) {
    checkRecipient(recipient, name);
  }
  return recipients;
}
