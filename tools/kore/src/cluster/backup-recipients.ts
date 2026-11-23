import { isAgeRecipient, PLACEHOLDER_RECIPIENT } from "./export-recipient.js";

export interface BackupRecipientsInput {
  /** A canary backup is the only kind the drill-only recipient may read. */
  canary: boolean;
  /** The vps sops recipient and the recovery recipient, in that order. */
  recipients: readonly string[];
  drillRecipient?: string | undefined;
}

function assertPublicKey(value: string): void {
  if (value === PLACEHOLDER_RECIPIENT) {
    throw new Error(
      `the recipient ${value} is still the placeholder; set the public age1... recipient before backing up`,
    );
  }
  if (!isAgeRecipient(value)) {
    throw new Error(
      `"${value}" is not a valid age recipient (expected age1 followed by 58 characters); set the public recipient printed by age-keygen`,
    );
  }
}

/**
 * The public keys one backup is encrypted to. A real-data backup lists exactly
 * its two recipients and never the drill-only one; a canary backup adds the
 * drill-only recipient, so the drill can read it and nothing real.
 */
export function backupRecipients(input: BackupRecipientsInput): string[] {
  const { canary, recipients, drillRecipient } = input;
  if (!canary && drillRecipient !== undefined) {
    throw new Error(
      "the drill-only recipient encrypts canary backups only; a real-data backup is never encrypted to it",
    );
  }
  if (recipients.length !== 2) {
    throw new Error(
      `a backup lists exactly two recipients, the vps and the recovery recipient; got ${recipients.length}`,
    );
  }
  recipients.forEach(assertPublicKey);
  if (recipients[0] === recipients[1]) {
    throw new Error("the two recipients must differ");
  }
  if (!canary) {
    return [...recipients];
  }
  if (drillRecipient === undefined) {
    throw new Error("a canary backup needs the drill-only recipient");
  }
  assertPublicKey(drillRecipient);
  if (recipients.includes(drillRecipient)) {
    throw new Error(
      "the drill-only recipient must differ from the real-data recipients",
    );
  }
  return [...recipients, drillRecipient];
}
