import type { Repository } from "../config/index.js";
import { beforeEach, expect, test, vi } from "vitest";
import {
  CommandError,
  CommandTimeoutError,
  type Runner,
} from "../runtime/index.js";
import { argocdApplicationsCheck } from "./readiness-argocd.js";
import { pollUntil } from "./readiness-poll.js";

// Reads of the Application list that kubectl fails to write (#1380), split from
// readiness-argocd.spec.ts to keep both under the file-length limit.

vi.mock("./readiness-poll.js");

const repository = {
  environment: { kubeContext: "k3d-kore-local" },
} as unknown as Repository;
const BASE = ["--context", "kore-local", "--namespace", "argocd"];
const RESOURCE = "applications.argoproj.io";

beforeEach(() => {
  vi.mocked(pollUntil).mockReset();
  vi.mocked(pollUntil).mockImplementation(async (_timeout, probe) => {
    const reason = await probe();
    if (reason !== undefined) {
      throw new Error(reason);
    }
  });
});

function fullStdoutBuffer(): CommandError {
  return new CommandError(
    "kubectl",
    [...BASE, "get", RESOURCE, "--output", "json"],
    {
      stdout: "",
      stderr: "error: write /dev/stdout: no buffer space available",
      code: 1,
    },
  );
}

const healthyList = {
  stdout: JSON.stringify({
    items: [
      {
        metadata: { name: "opa-authorizer" },
        status: { sync: { status: "Synced" }, health: { status: "Healthy" } },
      },
    ],
  }),
  stderr: "",
  code: 0,
};

test("a read that hits a full kubectl stdout buffer once is read again, and the retry is judged as the answer (#1380)", async () => {
  const run = vi
    .fn()
    .mockRejectedValueOnce(fullStdoutBuffer())
    .mockResolvedValueOnce(healthyList);
  const runner = { run } as unknown as Runner;

  await expect(
    argocdApplicationsCheck({ repository, runner, base: BASE }, RESOURCE)?.run(
      "3s",
    ),
  ).resolves.toBeUndefined();
  expect(run).toHaveBeenCalledTimes(2);
  expect(run).toHaveBeenLastCalledWith(
    "kubectl",
    [...BASE, "get", RESOURCE, "--output", "json"],
    { capture: true },
  );
});

test("a read that keeps hitting the full stdout buffer fails after three reads, naming the command and the cause (#1380)", async () => {
  const run = vi.fn().mockRejectedValue(fullStdoutBuffer());
  const runner = { run } as unknown as Runner;

  await expect(
    argocdApplicationsCheck({ repository, runner, base: BASE }, RESOURCE)?.run(
      "3s",
    ),
  ).rejects.toThrow(
    new Error(
      "kubectl --context kore-local --namespace argocd get applications.argoproj.io --output json failed (1): error: write /dev/stdout: no buffer space available; 3 reads failed the same way, so Application health is unknown; run kubectl --context k3d-kore-local -n argocd get applications.argoproj.io",
    ),
  );
  expect(run).toHaveBeenCalledTimes(3);
});

test("any other failure reading the Applications is rethrown at once, never read again (#1380)", async () => {
  const forbidden = new CommandError(
    "kubectl",
    [...BASE, "get", RESOURCE, "--output", "json"],
    {
      stdout: "",
      stderr:
        'applications.argoproj.io is forbidden: User "kore" cannot list resource',
      code: 1,
    },
  );
  const run = vi.fn().mockRejectedValue(forbidden);
  const runner = { run } as unknown as Runner;

  await expect(
    argocdApplicationsCheck({ repository, runner, base: BASE }, RESOURCE)?.run(
      "3s",
    ),
  ).rejects.toBe(forbidden);
  expect(run).toHaveBeenCalledTimes(1);
});

test("a kubectl timeout whose stderr mentions the full buffer is rethrown after one read, since it hung rather than failed to write (#1380)", async () => {
  const args = [...BASE, "get", RESOURCE, "--output", "json"];
  const timeout = new CommandTimeoutError(
    "kubectl",
    args,
    {
      stdout: "",
      stderr: "error: write /dev/stdout: no buffer space available",
      code: 1,
    },
    30000,
    false,
  );
  const run = vi.fn().mockRejectedValue(timeout);
  const runner = { run } as unknown as Runner;

  await expect(
    argocdApplicationsCheck({ repository, runner, base: BASE }, RESOURCE)?.run(
      "3s",
    ),
  ).rejects.toBe(timeout);
  expect(run).toHaveBeenCalledTimes(1);
});

test("an error whose message only mentions the full buffer, but is not kubectl's stderr, is rethrown after one read (#1380)", async () => {
  const mentioned = new Error(
    "write /dev/stdout: no buffer space available, as quoted in a note",
  );
  const run = vi.fn().mockRejectedValue(mentioned);
  const runner = { run } as unknown as Runner;

  await expect(
    argocdApplicationsCheck({ repository, runner, base: BASE }, RESOURCE)?.run(
      "3s",
    ),
  ).rejects.toBe(mentioned);
  expect(run).toHaveBeenCalledTimes(1);
});

test("the failure after the bounded reads keeps the kubectl error as its cause (#1380)", async () => {
  const buffer = fullStdoutBuffer();
  const run = vi.fn().mockRejectedValue(buffer);
  const runner = { run } as unknown as Runner;

  const check = argocdApplicationsCheck(
    { repository, runner, base: BASE },
    RESOURCE,
  );
  const failure = await check?.run("3s").catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(Error);
  expect((failure as Error).cause).toBe(buffer);
});
