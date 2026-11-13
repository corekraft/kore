import { expect, test } from "vitest";
import {
  CommandError,
  CommandTimeoutError,
  type RunOptions,
  type RunResult,
  type Runner,
} from "./runner.js";
import { isTransientKubectlFailure, withTransientRetry } from "./retry.js";

type Step = { fail: string } | "ok";

class ScriptedRunner implements Runner {
  calls: {
    command: string;
    args: readonly string[];
    input: string | undefined;
  }[] = [];
  constructor(private readonly steps: Step[]) {}
  async run(
    command: string,
    args: readonly string[],
    options?: RunOptions,
  ): Promise<RunResult> {
    this.calls.push({ command, args, input: options?.input });
    const step = this.steps.shift() ?? "ok";
    if (step === "ok") {
      return { stdout: "", stderr: "", code: 0 };
    }
    throw new CommandError(command, args, {
      stdout: "",
      stderr: step.fail,
      code: 1,
    });
  }
}

const apply = [
  "--context",
  "kore-local",
  "apply",
  "--server-side",
  "--filename=-",
];
const timeout =
  'error: error when retrieving current configuration: Get "https://x": context deadline exceeded (Client.Timeout or context cancellation while reading body)';

function harness(steps: Step[]) {
  const inner = new ScriptedRunner(steps);
  const logs: string[] = [];
  const sleeps: number[] = [];
  const runner = withTransientRetry(inner, {
    attempts: 4,
    baseDelayMs: 100,
    maxDelayMs: 300,
    log: (line) => logs.push(line),
    sleep: async (ms) => void sleeps.push(ms),
  });
  return { inner, logs, sleeps, runner };
}

test("a transient apply failure is retried and replays the same stdin", async () => {
  const { inner, logs, sleeps, runner } = harness([{ fail: timeout }, "ok"]);
  await runner.run("kubectl", apply, { input: "SECRET-PAYLOAD" });
  expect(inner.calls.map((call) => call.input)).toEqual([
    "SECRET-PAYLOAD",
    "SECRET-PAYLOAD",
  ]);
  expect(sleeps).toEqual([100]);
  expect(logs).toHaveLength(1);
  expect(logs[0]).toContain("kubectl apply");
  expect(logs[0]).toContain("context deadline exceeded");
  expect(logs[0]).not.toContain("SECRET-PAYLOAD");
});

test("a validation or authorization error fails at once without a retry", async () => {
  for (const stderr of [
    'The Secret "x" is invalid: data: Invalid value',
    'Error from server (Forbidden): secrets is forbidden: User "u" cannot patch',
    'Error from server (Forbidden): admission webhook "w" denied the request: context deadline exceeded is not allowed',
  ]) {
    const { inner, logs, runner } = harness([{ fail: stderr }]);
    await expect(runner.run("kubectl", apply)).rejects.toBeInstanceOf(
      CommandError,
    );
    expect(inner.calls).toHaveLength(1);
    expect(logs).toEqual([]);
  }
});

test("retries are bounded with exponential, capped backoff and the final error names the cause", async () => {
  const { inner, sleeps, runner } = harness(
    Array.from({ length: 10 }, () => ({ fail: timeout })),
  );
  const error = await runner.run("kubectl", apply).catch((e: unknown) => e);
  expect(inner.calls).toHaveLength(4);
  expect(sleeps).toEqual([100, 200, 300]);
  expect(error).toBeInstanceOf(Error);
  const message = (error as Error).message;
  expect(message).toContain("kubectl apply");
  expect(message).toContain("4 attempts");
  expect(message).toContain("context deadline exceeded");
  expect(message).toContain("API server or an admission webhook");
  expect((error as Error).cause).toBeInstanceOf(CommandError);
});

test("only mutating kubectl verbs are retried, so reads on a stopped cluster fail fast", async () => {
  const get = ["--context", "kore-local", "get", "nodes"];
  const { inner, runner } = harness([{ fail: timeout }]);
  await expect(runner.run("kubectl", get)).rejects.toBeInstanceOf(CommandError);
  expect(inner.calls).toHaveLength(1);
  const helm = harness([{ fail: timeout }]);
  await expect(helm.runner.run("helm", ["upgrade"])).rejects.toBeInstanceOf(
    CommandError,
  );
  expect(helm.inner.calls).toHaveLength(1);
});

test.each([
  'Internal error occurred: failed calling webhook "v.cert-manager.io": failed to call webhook: Post "https://cm.svc:443/validate": dial tcp 10.0.0.1:443: connect: connection refused',
  'failed calling webhook "x": no endpoints available for service "gatekeeper-webhook-service"',
  "Error from server (ServiceUnavailable): the server is currently unable to handle the request",
  "Error from server (Timeout): request did not complete within requested timeout - Please retry",
  "Error from server: etcdserver: leader changed",
  "Error from server: etcdserver: request timed out",
  "Unable to connect to the server: net/http: TLS handshake timeout",
  "The connection to the server 192.168.49.2:8443 was refused - did you specify the right host or port?",
  "Error from server (TooManyRequests): Too many requests, please try again later.",
  "error validating STDIN: error validating data: failed to download openapi: Get x: context deadline exceeded. Please retry",
])("classifies as transient: %s", (stderr) => {
  expect(isTransientKubectlFailure(stderr)).toBe(true);
});

test.each([
  "",
  'The Secret "x" is invalid',
  "error: unknown field spec.foo",
  "Error from server (NotFound): namespaces x not found",
  "Error from server (AlreadyExists): secrets x already exists",
])("classifies as permanent: %s", (stderr) => {
  expect(isTransientKubectlFailure(stderr)).toBe(false);
});

test("a command killed at its timeout is never retried as a transient failure", async () => {
  const calls: number[] = [];
  const hung: Runner = {
    async run(command, args) {
      calls.push(1);
      throw new CommandTimeoutError(
        command,
        args,
        { stdout: "", stderr: "TLS handshake timeout", code: 143 },
        1000,
        false,
      );
    },
  };
  await expect(
    withTransientRetry(hung, { sleep: async () => {}, log: () => {} }).run(
      "kubectl",
      apply,
    ),
  ).rejects.toBeInstanceOf(CommandTimeoutError);
  expect(calls).toHaveLength(1);
});
