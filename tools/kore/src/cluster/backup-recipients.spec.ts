import { beforeEach, expect, test, vi } from "vitest";
import { backupRecipients } from "./backup-recipients.js";
import { isAgeRecipient } from "./export-recipient.js";

vi.mock("./export-recipient.js");

const VPS = `age1${"q".repeat(58)}`;
const RECOVERY = `age1${"r".repeat(58)}`;
const DRILL = `age1${"d".repeat(58)}`;

beforeEach(() => {
  // The format check is the export domain's own unit; here only the answer matters.
  vi.mocked(isAgeRecipient).mockImplementation((value) =>
    [VPS, RECOVERY, DRILL].includes(value),
  );
});

test("a real-data backup lists exactly its two recipients, in the order given, and never the drill-only one", () => {
  expect(
    backupRecipients({ canary: false, recipients: [VPS, RECOVERY] }),
  ).toEqual([VPS, RECOVERY]);
});

test("a canary backup lists its two recipients and the drill-only recipient last", () => {
  expect(
    backupRecipients({
      canary: true,
      recipients: [VPS, RECOVERY],
      drillRecipient: DRILL,
    }),
  ).toEqual([VPS, RECOVERY, DRILL]);
});

test("a real-data backup with a third recipient is refused, and the count is named", () => {
  expect(() =>
    backupRecipients({ canary: false, recipients: [VPS, RECOVERY, DRILL] }),
  ).toThrow(
    "a backup lists exactly two recipients, the vps and the recovery recipient; got 3",
  );
});

test("the drill-only recipient is refused on a real-data backup, so it can never read real data", () => {
  expect(() =>
    backupRecipients({
      canary: false,
      recipients: [VPS, RECOVERY],
      drillRecipient: DRILL,
    }),
  ).toThrow(
    "the drill-only recipient encrypts canary backups only; a real-data backup is never encrypted to it",
  );
});

test("a canary backup without its drill-only recipient is refused, because the drill could not read it", () => {
  expect(() =>
    backupRecipients({ canary: true, recipients: [VPS, RECOVERY] }),
  ).toThrow("a canary backup needs the drill-only recipient");
});

test("the placeholder recipient is refused by name, so an unconfigured key never encrypts", () => {
  expect(() =>
    backupRecipients({
      canary: false,
      recipients: ["AGE-RECIPIENT-MUST-BE-CONFIGURED", RECOVERY],
    }),
  ).toThrow(
    "the recipient AGE-RECIPIENT-MUST-BE-CONFIGURED is still the placeholder; set the public age1... recipient before backing up",
  );
});

test("a value that is not an age recipient is refused and named", () => {
  expect(() =>
    backupRecipients({ canary: false, recipients: ["not-a-key", RECOVERY] }),
  ).toThrow(
    '"not-a-key" is not a valid age recipient (expected age1 followed by 58 characters)',
  );
});

test("the same recipient twice is refused, because it would not add a second key", () => {
  expect(() =>
    backupRecipients({ canary: false, recipients: [VPS, VPS] }),
  ).toThrow("the two recipients must differ");
});
