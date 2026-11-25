import { describe, expect, test, vi } from "vitest";

// The command handlers have behaviour, so they are mocked; only the command
// table (a constant) and the usage text (a constant) are read here (ADR 0098).
vi.mock("./commands-infra.js", () => ({
  clusterCommand: vi.fn(),
  platformCommand: vi.fn(),
  appCommand: vi.fn(),
  dataCommand: vi.fn(),
  backupCommand: vi.fn(),
  statusCommand: vi.fn(),
}));
vi.mock("./commands-dns.js", () => ({ dnsCommand: vi.fn() }));
vi.mock("./commands-delivery.js", () => ({ evalCommand: vi.fn() }));
vi.mock("./commands-ops.js", () => ({ opsCommand: vi.fn() }));
vi.mock("./commands-policy.js", () => ({ policyCommand: vi.fn() }));
vi.mock("./commands-local.js", () => ({
  localCommand: vi.fn(),
  registryCommand: vi.fn(),
  signerCommand: vi.fn(),
  secretsCommand: vi.fn(),
  trustCommand: vi.fn(),
}));
vi.mock("./commands-read.js", () => ({
  doctorCommand: vi.fn(),
  journalCommand: vi.fn(),
  validateCommand: vi.fn(),
}));

import { COMMANDS } from "./commands.js";
import { usage } from "./usage.js";

// usage is a constant string: the one unit here is the text itself.

test("usage opens with the product name and the usage heading", () => {
  expect(usage.split("\n").slice(0, 3)).toEqual([
    "Kore local platform orchestration",
    "",
    "Usage:",
  ]);
});

test("usage describes the validate warnings and the environment exemptionCheck mode", () => {
  expect(usage).toContain(
    "environment exemptionCheck: audit|enforce, unset reads as audit",
  );
});

test("usage does not mention the removed tunnel command", () => {
  expect(usage).not.toMatch(/tunnel/i);
});

test("usage lists a mutating command with the --environment it requires", () => {
  expect(usage).toContain(
    "  kore local up|down --environment local [--prune [--purge-data]] [--force]",
  );
  expect(usage).toContain(
    "  kore cluster up|stop|destroy --environment <name> [--yes] [--purge-data]",
  );
});

test("usage states that every mutation requires --environment and that reads default to local", () => {
  expect(usage).toContain("Every mutation requires --environment");
  expect(usage).toContain("are read-only and default to local.");
});

/** The command named on each `  kore <command> ...` line of the usage text. */
const documented = new Set(
  usage
    .split("\n")
    .filter((line) => line.startsWith("  kore "))
    .map((line) => line.trim().split(/\s+/)[1]),
);

describe("kore usage text names every command in the command table", () => {
  test.each([...COMMANDS.keys()])(
    "the usage text names the kore %s command",
    (name) => {
      expect(
        [...documented],
        `kore ${name} is missing from the usage text`,
      ).toContain(name);
    },
  );
});

test("usage lists kore status read-only, and the validate --platform-claims check with its flag gate", () => {
  expect(usage).toContain("kore status [--environment local] [--json]");
  expect(usage).toContain("exits 1 while one is not ready");
  expect(usage).toContain("[--platform-claims <file>]");
  expect(usage).toContain(
    "skipped with a warning while the platform-organization-service-apis flag is off",
  );
});

test("usage names the read-only fetch-lock action with its output and commit flags", () => {
  expect(usage).toContain(
    "kore local fetch-lock --output <platform-charts.lock.json> [--commit <sha>] [--json]",
  );
});
