import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import { exportRecipient, PLACEHOLDER_RECIPIENT } from "./export-recipient.js";
import { fakeRepository } from "./cluster-support.js";

vi.mock("node:fs/promises");
vi.mock("node:path");

const RECIPIENT = `age1${"q".repeat(58)}`;
const OTHER = `age1${"p".repeat(58)}`;

const repository = fakeRepository();

function sopsYaml(...rules: string[]): string {
  return `creation_rules:\n${rules.join("")}`;
}

function rule(environment: string, age: string): string {
  return `  - path_regex: infra/environments/${environment}/secrets/.*\\.enc\\.yaml$\n    age: ${age}\n`;
}

beforeEach(() => {
  vi.mocked(join).mockImplementation((...parts: string[]) => parts.join("/"));
});

test("the recipient is the age key of the rule that covers this environment's secrets", async () => {
  vi.mocked(readFile).mockResolvedValue(
    sopsYaml(rule("staging", OTHER), rule("local", RECIPIENT)),
  );
  expect(await exportRecipient(repository)).toBe(RECIPIENT);
});

test("the recipient is read from the repository's .sops.yaml as text, and no key material is read", async () => {
  vi.mocked(readFile).mockResolvedValue(sopsYaml(rule("local", RECIPIENT)));
  await exportRecipient(repository);
  expect(readFile).toHaveBeenCalledTimes(1);
  expect(readFile).toHaveBeenCalledWith("/repo/.sops.yaml", "utf8");
});

test("a quoted recipient with a trailing comment is unquoted to the bare key", async () => {
  vi.mocked(readFile).mockResolvedValue(
    sopsYaml(
      `  - path_regex: infra/environments/local/secrets/.*\\.enc\\.yaml$\n    age: "${RECIPIENT}" # the public key\n`,
    ),
  );
  expect(await exportRecipient(repository)).toBe(RECIPIENT);
});

test("an unreadable .sops.yaml is reported with the cause, before any recipient is looked up", async () => {
  vi.mocked(readFile).mockRejectedValue(new Error("ENOENT: no such file"));
  await expect(exportRecipient(repository)).rejects.toThrow(
    "cannot read .sops.yaml for the age recipient: ENOENT: no such file",
  );
});

test("a repository whose .sops.yaml has no rule for this environment names the environment to add one for", async () => {
  vi.mocked(readFile).mockResolvedValue(sopsYaml(rule("staging", RECIPIENT)));
  await expect(exportRecipient(repository)).rejects.toThrow(
    ".sops.yaml has no creation rule with an age recipient for environments/local/; add one before exporting",
  );
});

test("the placeholder recipient is refused, so no export is encrypted to nobody", async () => {
  vi.mocked(readFile).mockResolvedValue(
    sopsYaml(rule("local", PLACEHOLDER_RECIPIENT)),
  );
  await expect(exportRecipient(repository)).rejects.toThrow(
    `the age recipient in .sops.yaml for local is still the placeholder ${PLACEHOLDER_RECIPIENT}`,
  );
});

test("a malformed recipient is refused with the expected shape", async () => {
  vi.mocked(readFile).mockResolvedValue(
    sopsYaml(rule("local", "not-an-age-key")),
  );
  await expect(exportRecipient(repository)).rejects.toThrow(
    '"not-an-age-key" in .sops.yaml is not a valid age recipient (expected age1 followed by 58 characters)',
  );
});

test("a recipient one character short of the age format is refused", async () => {
  vi.mocked(readFile).mockResolvedValue(
    sopsYaml(rule("local", RECIPIENT.slice(0, -1))),
  );
  await expect(exportRecipient(repository)).rejects.toThrow(
    "is not a valid age recipient",
  );
});
