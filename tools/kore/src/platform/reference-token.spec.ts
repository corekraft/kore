import { expect, test, vi } from "vitest";
import { CommandError } from "../runtime/index.js";
import { readReferenceApiToken } from "./reference-token.js";
import { fakeRepository, fakeRunner } from "./platform-support.js";

// Docs: docs/decisions/0073-digest-required-admission.md
// The live smoke spec obtains the API token from the cluster Secret, never
// from .kore/. These fast tests fake the runner; no Secret value is printed.

const token = "ab".repeat(32);
const encoded = Buffer.from(token).toString("base64");
const repository = fakeRepository();

test("the token is read from the reference Secret with the configured context, one key only", async () => {
  const { runner, run } = fakeRunner(() => encoded);

  expect(await readReferenceApiToken(repository, runner)).toBe(token);

  expect(run).toHaveBeenCalledTimes(1);
  expect(run).toHaveBeenCalledWith(
    "kubectl",
    [
      "--context",
      "k3d-kore-local",
      "--namespace",
      "reference",
      "get",
      "secret/reference-app",
      "--output=jsonpath={.data.API_TOKEN}",
    ],
    { capture: true },
  );
});

test("the helper never touches .kore/ and never prints the token", async () => {
  const { runner, run } = fakeRunner(() => encoded);
  const log = vi.spyOn(console, "log");

  await readReferenceApiToken(repository, runner);

  expect(JSON.stringify(run.mock.calls)).not.toContain(".kore");
  expect(log).not.toHaveBeenCalled();
});

test("a missing Secret names the fix and keeps the failed command as its cause", async () => {
  const failure = new CommandError("kubectl", [], {
    stdout: "",
    stderr: 'Error from server (NotFound): secrets "reference-app" not found',
    code: 1,
  });
  const { runner, run } = fakeRunner();
  run.mockRejectedValueOnce(failure);

  const error = await readReferenceApiToken(repository, runner).catch(
    (caught: unknown) => caught,
  );

  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe(
    "cannot read API_TOKEN from Secret reference/reference-app: run `kore app up reference` so the Secret exists, then retry",
  );
  expect((error as Error).cause).toBe(failure);
});

test("an error that is not a failed command is rethrown unchanged", async () => {
  const unexpected = new Error("runner crashed");
  const { runner, run } = fakeRunner();
  run.mockRejectedValueOnce(unexpected);

  await expect(readReferenceApiToken(repository, runner)).rejects.toBe(
    unexpected,
  );
});

test("an empty token is refused, and the message names the key without echoing a value", async () => {
  const { runner } = fakeRunner(() => "");

  await expect(readReferenceApiToken(repository, runner)).rejects.toThrow(
    "Secret reference/reference-app has an empty or malformed API_TOKEN; run `kore app up reference` to regenerate it",
  );
});

test("a malformed token is refused without echoing the value", async () => {
  const malformed = Buffer.from("not-hex-token").toString("base64");
  const { runner } = fakeRunner(() => malformed);

  const error = await readReferenceApiToken(repository, runner).catch(
    (caught: unknown) => caught,
  );

  expect((error as Error).message).toBe(
    "Secret reference/reference-app has an empty or malformed API_TOKEN; run `kore app up reference` to regenerate it",
  );
  expect((error as Error).message).not.toContain("not-hex-token");
});
