// Docs: docs/decisions/0155-retained-databases-are-backed-up-by-a-scheduled-age-encrypted-dump-and-restored-only-from-the-controller.md
// Reads the age recipients `.sops.yaml` names for an environment's secrets. The
// parse is pure; loadSopsRecipients reads the one file and no key material.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** The placeholder a repository holds until the owner names a real recipient. */
export const PLACEHOLDER_RECIPIENT = "AGE-RECIPIENT-MUST-BE-CONFIGURED";
const AGE_RECIPIENT = /^age1[023456789acdefghjklmnpqrstuvwxyz]{58}$/;

function unquote(value: string): string {
  return value
    .replace(/\s+#.*$/, "")
    .trim()
    .replace(/^(["'])(.*)\1$/, "$2");
}

/** The raw `age:` value of the first creation rule whose path names the environment, or undefined. */
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

/**
 * The age recipients the `.sops.yaml` text names for an environment's secrets,
 * each entry of the comma-separated list trimmed; undefined when no creation
 * rule for the environment names an age recipient.
 */
export function environmentRecipients(
  text: string,
  name: string,
): string[] | undefined {
  const value = findRecipients(text, name);
  return value === undefined
    ? undefined
    : value.split(",").map((entry) => entry.trim());
}

/**
 * The recipients of an environment read from `.sops.yaml` at the repository
 * root. Undefined when the file does not exist or names none for the
 * environment; any other read failure is thrown, naming the file.
 */
export async function loadSopsRecipients(
  root: string,
  name: string,
): Promise<string[] | undefined> {
  let text: string;
  try {
    text = await readFile(join(root, ".sops.yaml"), "utf8");
  } catch (error) {
    if (isMissingFile(error)) {
      return undefined;
    }
    throw new Error(
      `cannot read .sops.yaml for the age recipients: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  return environmentRecipients(text, name);
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
