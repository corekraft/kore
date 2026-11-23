import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Repository } from "../config/index.js";

export const PLACEHOLDER_RECIPIENT = "AGE-RECIPIENT-MUST-BE-CONFIGURED";
const AGE_RECIPIENT = /^age1[023456789acdefghjklmnpqrstuvwxyz]{58}$/;

function unquote(value: string): string {
  return value
    .replace(/\s+#.*$/, "")
    .trim()
    .replace(/^(["'])(.*)\1$/, "$2");
}

function findRecipients(text: string, name: string): string | undefined {
  let inRule = false;
  let matches = false;
  for (const line of text.split("\n")) {
    const rule = line.match(/^\s*-\s+path_regex:\s*(.*)$/);
    if (rule) {
      inRule = true;
      matches = (rule[1] ?? "").includes(`environments/${name}/`);
      continue;
    }
    const age = line.match(/^\s+age:\s*(.*)$/);
    if (inRule && matches && age) {
      return unquote(age[1] ?? "");
    }
  }
  return undefined;
}

/** True for a public age key: `age1` and 58 characters from the bech32 alphabet. */
export function isAgeRecipient(value: string): boolean {
  return AGE_RECIPIENT.test(value);
}

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
  const value = findRecipients(text, name);
  if (value === undefined) {
    throw new Error(
      `.sops.yaml has no creation rule with an age recipient for environments/${name}/; add one before exporting`,
    );
  }
  const recipients = value.split(",").map((entry) => entry.trim());
  for (const recipient of recipients) {
    checkRecipient(recipient, name);
  }
  return recipients;
}
