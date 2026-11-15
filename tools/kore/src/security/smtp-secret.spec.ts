// Docs: docs/decisions/0034-registry-authentication-and-authorization.md (stream-only Secrets)
import { beforeEach, expect, test, vi } from "vitest";
import { withSecretsRedacted } from "../images/index.js";
import { applySmtpCredentials, parseSmtpCredentials } from "./smtp-secret.js";
import { fakeRepository, fakeRunner } from "./security-support.js";

vi.mock("../images/index.js");

const repository = fakeRepository();
const password = "s3cret-smtp-password";

beforeEach(() => {
  vi.mocked(withSecretsRedacted).mockImplementation(
    async (_secrets, operation) => await operation(),
  );
});

test("the SMTP login reaches the cluster only on kubectl's stdin, in the configured context, and never in an argument", async () => {
  const { runner, run } = fakeRunner();
  await applySmtpCredentials(repository, runner, {
    user: "kore-alerts",
    password,
  });
  expect(run).toHaveBeenCalledTimes(1);
  const [command, args, options] = run.mock.calls[0]!;
  expect([command, args]).toEqual([
    "kubectl",
    [
      "--context",
      "k3d-kore-local",
      "apply",
      "--server-side",
      "--field-manager=kore-grafana-smtp",
      "--force-conflicts",
      "--filename=-",
    ],
  ]);
  expect(JSON.parse(options!.input!)).toEqual({
    apiVersion: "v1",
    kind: "Secret",
    metadata: { name: "grafana-smtp", namespace: "observability" },
    type: "Opaque",
    stringData: { user: "kore-alerts", password },
  });
  expect(JSON.stringify(args)).not.toContain(password);
});

test("the password is registered for redaction while kubectl runs, so no output can leak it", async () => {
  const { runner } = fakeRunner();
  await applySmtpCredentials(repository, runner, { user: "u", password });
  expect(withSecretsRedacted).toHaveBeenCalledWith(
    [password],
    expect.any(Function),
  );
});

test("credentials are read from a JSON object on stdin", () => {
  expect(
    parseSmtpCredentials(JSON.stringify({ user: "u", password: "p" })),
  ).toEqual({ user: "u", password: "p" });
});

test("a stdin that is not JSON, or lacks a user or password, is refused without echoing its content", () => {
  const usage =
    'stream {"user": "<smtp user>", "password": "<smtp password>"} on stdin';
  expect(() => parseSmtpCredentials(`not json ${password}`)).toThrow(
    new Error(`SMTP credentials are not JSON; ${usage}`),
  );
  expect(() => parseSmtpCredentials(JSON.stringify({ user: "u" }))).toThrow(
    new Error(`SMTP credentials need a user and a password; ${usage}`),
  );
});
