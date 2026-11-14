import { expect, test } from "vitest";
import {
  boolFlag,
  parseArgs,
  requireEnvironment,
  stringFlag,
} from "./flags.js";

// flags.ts has no collaborators: its helpers call each other, and that is the unit.

test("parseArgs keeps --key=value and --key value pairs, standalone flags, and positional arguments", () => {
  const parsed = parseArgs([
    "app",
    "reference",
    "--environment=staging",
    "--json",
    "--output",
    "rendered",
  ]);
  expect(parsed.positional).toEqual(["app", "reference"]);
  expect(parsed.flags).toEqual(
    new Map<string, string | boolean>([
      ["environment", "staging"],
      ["json", true],
      ["output", "rendered"],
    ]),
  );
});

test("parseArgs treats a flag followed by another flag as standalone, never as taking that flag's name as its value", () => {
  const parsed = parseArgs(["--json", "--environment", "local"]);
  expect(parsed.flags.get("json")).toBe(true);
  expect(parsed.flags.get("environment")).toBe("local");
});

test("stringFlag returns the value of a flag that carries one, and nothing for a standalone flag", () => {
  const parsed = parseArgs(["--environment=staging", "--json"]);
  expect(stringFlag(parsed, "environment")).toBe("staging");
  expect(stringFlag(parsed, "json")).toBeUndefined();
  expect(stringFlag(parsed, "missing")).toBeUndefined();
});

test("boolFlag is true only for a standalone flag, never for a flag that carries a value", () => {
  const parsed = parseArgs(["--json", "--environment=staging"]);
  expect(boolFlag(parsed, "json")).toBe(true);
  expect(boolFlag(parsed, "environment")).toBe(false);
  expect(boolFlag(parsed, "missing")).toBe(false);
});

test("requireEnvironment returns the named environment", () => {
  expect(requireEnvironment(parseArgs(["--environment=staging"]))).toBe(
    "staging",
  );
});

test("requireEnvironment refuses a missing --environment and a bare --environment with no value", () => {
  const message = "--environment is required for mutating commands";
  expect(() => requireEnvironment(parseArgs([]))).toThrow(message);
  expect(() => requireEnvironment(parseArgs(["--environment"]))).toThrow(
    message,
  );
});
