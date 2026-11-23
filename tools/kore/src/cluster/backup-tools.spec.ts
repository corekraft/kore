import { beforeEach, expect, test, vi } from "vitest";
import { parseDumpHeader } from "./backup-header.js";
import { dumpDatabase, encryptDump } from "./backup-tools.js";
import { ageArguments } from "./export.js";
import { fakeRunner } from "./cluster-support.js";

vi.mock("./backup-header.js");
vi.mock("./export.js");

const DUMP = "-- Dumped from database version 17.5\nCREATE TABLE t (id int);\n";
const CIPHER = "-----BEGIN AGE ENCRYPTED FILE-----\nabc\n";
const RECIPIENTS = ["age1vps", "age1recovery"];
const HEADER = { postgresMajor: 17, dumpVersion: "18.1" };

beforeEach(() => {
  vi.mocked(parseDumpHeader).mockReturnValue(HEADER);
  vi.mocked(ageArguments).mockReturnValue([
    "--armor",
    "--recipient",
    "age1vps",
  ]);
});

test("the dump is plain pg_dump of the database, never prompting for a password, and its header is read", async () => {
  const { runner, run } = fakeRunner(() => DUMP);
  await expect(dumpDatabase(runner, "app")).resolves.toEqual({
    plaintext: DUMP,
    header: HEADER,
  });
  expect(run).toHaveBeenCalledWith(
    "pg_dump",
    ["--format=plain", "--no-password", "--dbname=app"],
    { capture: true },
  );
  expect(parseDumpHeader).toHaveBeenCalledWith(DUMP);
});

test("a dump whose header is refused is not returned, so nothing reaches encryption", async () => {
  vi.mocked(parseDumpHeader).mockImplementation(() => {
    throw new Error("no version line");
  });
  const { runner } = fakeRunner(() => "not a dump");
  await expect(dumpDatabase(runner, "app")).rejects.toThrow("no version line");
});

test("the plaintext is encrypted by age to the recipients the export arguments name, and only the ciphertext comes back", async () => {
  const { runner, run } = fakeRunner(() => CIPHER);
  await expect(encryptDump(runner, RECIPIENTS, DUMP)).resolves.toBe(CIPHER);
  expect(ageArguments).toHaveBeenCalledWith(RECIPIENTS);
  expect(run).toHaveBeenCalledWith(
    "age",
    ["--armor", "--recipient", "age1vps"],
    {
      capture: true,
      input: DUMP,
    },
  );
});
