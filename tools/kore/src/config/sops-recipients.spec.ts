// Docs: docs/decisions/0155-retained-databases-are-backed-up-by-a-scheduled-age-encrypted-dump-and-restored-only-from-the-controller.md
import { readFile } from "node:fs/promises";
import { beforeEach, expect, test, vi } from "vitest";
import {
  environmentRecipients,
  loadSopsRecipients,
} from "./sops-recipients.js";

vi.mock("node:fs/promises");

const RECIPIENT = `age1${"q".repeat(58)}`;
const OTHER = `age1${"p".repeat(58)}`;

function rule(environment: string, age: string): string {
  return `  - path_regex: infra/environments/${environment}/secrets/.*\\.enc\\.yaml$\n    age: ${age}\n`;
}

beforeEach(() => {
  vi.mocked(readFile).mockReset();
});

test("the recipients of an environment are the comma-separated age keys of its own creation rule", () => {
  const text = `creation_rules:\n${rule("local", RECIPIENT)}${rule("vps", `${RECIPIENT}, ${OTHER}`)}`;
  expect(environmentRecipients(text, "vps")).toEqual([RECIPIENT, OTHER]);
});

test("an environment with no creation rule has no recipients to read", () => {
  const text = `creation_rules:\n${rule("local", RECIPIENT)}`;
  expect(environmentRecipients(text, "vps")).toBeUndefined();
});

test("the sops file is read from the repository root, and its recipients come back for the environment", async () => {
  vi.mocked(readFile).mockResolvedValue(
    `creation_rules:\n${rule("vps", RECIPIENT)}`,
  );
  await expect(loadSopsRecipients("/repo", "vps")).resolves.toEqual([
    RECIPIENT,
  ]);
  expect(vi.mocked(readFile).mock.calls).toEqual([
    ["/repo/.sops.yaml", "utf8"],
  ]);
});

test("a repository with no .sops.yaml has no recipients, and the load does not fail", async () => {
  vi.mocked(readFile).mockRejectedValue(
    Object.assign(new Error("no such file"), { code: "ENOENT" }),
  );
  await expect(loadSopsRecipients("/repo", "vps")).resolves.toBeUndefined();
});

test("a .sops.yaml that cannot be read for another reason fails the load, naming the file", async () => {
  vi.mocked(readFile).mockRejectedValue(
    Object.assign(new Error("permission denied"), { code: "EACCES" }),
  );
  await expect(loadSopsRecipients("/repo", "vps")).rejects.toThrow(
    "permission denied",
  );
});
