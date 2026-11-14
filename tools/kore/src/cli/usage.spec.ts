import { expect, test } from "vitest";
import { usage } from "./usage.js";

// usage is a constant string: the one unit here is the text itself.

test("usage opens with the product name and the usage heading", () => {
  expect(usage.split("\n").slice(0, 3)).toEqual([
    "Kore local platform orchestration",
    "",
    "Usage:",
  ]);
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
