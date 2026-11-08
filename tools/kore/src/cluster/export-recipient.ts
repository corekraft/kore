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

function findRecipient(text: string, name: string): string | undefined {
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

/**
 * Reads the age recipient that `.sops.yaml` names for this environment's
 * secrets. The recipient is public; no key material is read.
 */
export async function exportRecipient(repository: Repository): Promise<string> {
  const name = repository.environment.name;
  let text: string;
  try {
    text = await readFile(join(repository.root, ".sops.yaml"), "utf8");
  } catch (error) {
    throw new Error(
      `cannot read .sops.yaml for the age recipient: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const recipient = findRecipient(text, name);
  if (recipient === undefined) {
    throw new Error(
      `.sops.yaml has no creation rule with an age recipient for environments/${name}/; add one before exporting`,
    );
  }
  if (recipient === PLACEHOLDER_RECIPIENT) {
    throw new Error(
      `the age recipient in .sops.yaml for ${name} is still the placeholder ${PLACEHOLDER_RECIPIENT}; set it to the public age recipient (age1...) you generated, then retry`,
    );
  }
  if (!AGE_RECIPIENT.test(recipient)) {
    throw new Error(
      `"${recipient}" in .sops.yaml is not a valid age recipient (expected age1 followed by 58 characters); set the public recipient printed by age-keygen`,
    );
  }
  return recipient;
}
