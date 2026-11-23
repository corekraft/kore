// Docs: docs/decisions/0164-the-platform-domain-is-a-run-time-value-and-the-repository-holds-a-placeholder.md
import { expect, test } from "vitest";
import { fakeEnvironment } from "./config-support.js";
import {
  loadRunTimeFile,
  missingRunTimeValues,
  parseRunTimeFile,
  RunTimeFileError,
  runTimeFilePath,
  runTimeNeededBy,
  runTimeValue,
  runTimeValues,
  runTimeVariables,
  type RunTimeFile,
  type RunTimeReads,
} from "./run-time.js";

const path = "/home/owner/.kore/runtime.env";
const publicIPv4 = runTimeVariables.publicIPv4;
const tailnetAddress = runTimeVariables.tailnetAddress;

const fileWith = (mode: number, text: string): RunTimeFile => ({
  path,
  mode,
  text,
});

/** Reads of a file with the given mode and text, as the disk would return them. */
const readsOf = (mode: number, text: string): RunTimeReads => ({
  stat: async () => ({ mode }),
  readFile: async () => text,
});

/** Reads that fail with the given error, as a disk read does when it is refused. */
const failingReads = (error: Error): RunTimeReads => ({
  stat: () => Promise.reject(error),
  readFile: () => Promise.reject(error),
});

/** The message a call throws, or an empty string when the call throws nothing. */
function messageOf(call: () => unknown): string {
  try {
    call();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
}

test("the run-time file lives under the machine's kore home, never in the repository", () => {
  expect(runTimeFilePath("/home/owner")).toBe("/home/owner/.kore/runtime.env");
});

test("NAME=value lines are read, and blank lines and # comments are skipped", () => {
  expect(
    parseRunTimeFile(
      "# this host\n\n KORE_PUBLIC_IPV4=192.0.2.10 \nKORE_TAILNET_ADDRESS=100.64.0.2\r\n",
      path,
    ),
  ).toEqual({
    KORE_PUBLIC_IPV4: "192.0.2.10",
    KORE_TAILNET_ADDRESS: "100.64.0.2",
  });
});

test("a line that is not NAME=value is refused by its line number, and its text is never echoed", () => {
  const message = messageOf(() =>
    parseRunTimeFile("KORE_PUBLIC_IPV4 192.0.2.10\n", path),
  );
  expect(message).toBe(`${path} line 1 is not NAME=value; fix that line`);
  expect(message).not.toContain("192.0.2.10");
});

test("a run-time file readable by anyone other than its owner is refused, naming the chmod that fixes it", () => {
  for (const mode of [0o644, 0o640, 0o604]) {
    expect(() =>
      runTimeValues(fileWith(mode, `${publicIPv4}=192.0.2.10\n`)),
    ).toThrow(
      new RunTimeFileError(
        `${path} is readable by others; run chmod 600 ${path}, then retry`,
      ),
    );
  }
});

test("an owner-only run-time file is read: mode 600 and 400 both pass", () => {
  for (const mode of [0o600, 0o400]) {
    expect(runTimeValues(fileWith(mode, `${publicIPv4}=192.0.2.10\n`))).toEqual(
      { KORE_PUBLIC_IPV4: "192.0.2.10" },
    );
  }
});

test("no file means no values, and that is not an error", () => {
  expect(runTimeValues(undefined)).toEqual({});
});

test("a missing file loads as no file, while any other read failure is rethrown", async () => {
  const missing = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  await expect(
    loadRunTimeFile(path, failingReads(missing)),
  ).resolves.toBeUndefined();

  const denied = Object.assign(new Error("EACCES: permission denied"), {
    code: "EACCES",
  });
  await expect(loadRunTimeFile(path, failingReads(denied))).rejects.toThrow(
    "EACCES",
  );
});

test("loading reads the file's permission bits and its text", async () => {
  await expect(
    loadRunTimeFile(path, readsOf(0o100600, `${publicIPv4}=192.0.2.10\n`)),
  ).resolves.toEqual({
    path,
    mode: 0o600,
    text: `${publicIPv4}=192.0.2.10\n`,
  });
});

test("an environment variable overrides the file, and an empty variable falls back to the file", () => {
  const values = { [publicIPv4]: "192.0.2.10" };
  expect(
    runTimeValue(publicIPv4, { [publicIPv4]: "198.51.100.4" }, values),
  ).toBe("198.51.100.4");
  expect(runTimeValue(publicIPv4, { [publicIPv4]: "" }, values)).toBe(
    "192.0.2.10",
  );
  expect(runTimeValue(publicIPv4, {}, {})).toBeUndefined();
});

test("with no flag needing a run-time value, nothing is needed and nothing is missing", () => {
  const environment = fakeEnvironment({ features: { "some-flag": true } });
  expect(runTimeNeededBy(environment)).toEqual([]);
});

test("a flag that is on lists each run-time value it needs, and a flag that is off lists none", () => {
  const needs = {
    "tailnet-flag": [tailnetAddress],
    "public-flag": [publicIPv4],
  } as const;
  const environment = fakeEnvironment({
    features: { "tailnet-flag": true, "public-flag": false },
  });
  expect(runTimeNeededBy(environment, needs)).toEqual([
    { flag: "tailnet-flag", name: tailnetAddress },
  ]);
});

test("the needed values the file and the environment do not supply are the missing ones", () => {
  const needed = [
    { flag: "tailnet-flag", name: tailnetAddress },
    { flag: "public-flag", name: publicIPv4 },
  ];
  expect(
    missingRunTimeValues(
      needed,
      { [tailnetAddress]: "100.64.0.2" },
      { [publicIPv4]: "192.0.2.10" },
    ),
  ).toEqual([]);
  expect(missingRunTimeValues(needed, {}, {})).toEqual(needed);
});
