import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { main } from "./cli.js";
import {
  boolFlag,
  parseArgs,
  requireEnvironment,
  stringFlag,
} from "./flags.js";

test("validate reports portable applications for the selected environment", async () => {
  const output: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    output.push(String(chunk));
    return true;
  });
  assert.equal(
    await main(["validate", "--environment", "managed-example", "--json"]),
    0,
  );
  assert.match(output.join(""), /"applications": \[\n\s+"reference"/);
});

test("the tunnel command no longer exists and usage does not mention it", async () => {
  await assert.rejects(
    main(["tunnel", "status", "--environment", "local", "--json"]),
    /unknown command: tunnel/,
  );
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  await main(["help"]);
  assert.doesNotMatch(String(log.mock.calls[0]?.[0]), /tunnel/i);
});

test("help prints usage without loading an environment", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  assert.equal(await main(["help"]), 0);
  assert.match(
    String(log.mock.calls[0]?.[0]),
    /Kore local platform orchestration/,
  );
});

test("mutating commands require an explicit environment", async () => {
  await assert.rejects(main(["cluster", "up"]), /--environment is required/);
});

test("app commands require an application name", async () => {
  await assert.rejects(main(["app", "status"]), /application name is required/);
});

test("unknown app actions are rejected before taking the lock", async () => {
  await assert.rejects(
    main(["app", "restart", "reference", "--environment", "local"]),
    /unknown app action: restart/,
  );
});

test("unknown commands report the supported CLI usage", async () => {
  await assert.rejects(
    main(["unknown-command"]),
    /unknown command: unknown-command/,
  );
});

test("CLI flags support equals values, standalone booleans, and positional arguments", () => {
  const parsed = parseArgs([
    "app",
    "reference",
    "--environment=staging",
    "--json",
    "--output",
    "rendered",
  ]);
  assert.deepEqual(parsed.positional, ["app", "reference"]);
  assert.equal(stringFlag(parsed, "environment"), "staging");
  assert.equal(stringFlag(parsed, "json"), undefined);
  assert.equal(boolFlag(parsed, "json"), true);
  assert.equal(boolFlag(parsed, "environment"), false);
  assert.equal(requireEnvironment(parsed), "staging");
  assert.throws(
    () => requireEnvironment(parseArgs([])),
    /--environment is required/,
  );
});
