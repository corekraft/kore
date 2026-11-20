import type { Repository } from "../config/index.js";
import { beforeEach, expect, test, vi } from "vitest";
import { CommandError, type Runner } from "../runtime/index.js";
import {
  argocdApplicationsCheck,
  waitForApplications,
} from "./readiness-argocd.js";
import { pollUntil } from "./readiness-poll.js";

vi.mock("./readiness-poll.js");

const repository = {
  environment: { kubeContext: "k3d-kore-local" },
} as unknown as Repository;
const BASE = ["--context", "kore-local", "--namespace", "argocd"];
const RESOURCE = "applications.argoproj.io";

interface App {
  name: string;
  sync?: string;
  health?: string;
  healthMessage?: string;
  conditions?: { type: string; message: string }[];
  operation?: string;
}

function list(...apps: App[]): string {
  return JSON.stringify({
    items: apps.map((app) => ({
      metadata: { name: app.name },
      status: {
        sync: app.sync ? { status: app.sync } : undefined,
        health: app.health
          ? { status: app.health, message: app.healthMessage }
          : undefined,
        conditions: app.conditions,
        operationState: app.operation ? { message: app.operation } : undefined,
      },
    })),
  });
}

function runnerReturning(stdout: string) {
  const run = vi.fn().mockResolvedValue({ stdout, stderr: "", exitCode: 0 });
  return { run, runner: { run } as unknown as Runner };
}

beforeEach(() => {
  vi.mocked(pollUntil).mockReset();
  vi.mocked(pollUntil).mockImplementation(async (_timeout, probe) => {
    const reason = await probe();
    if (reason !== undefined) {
      throw new Error(reason);
    }
  });
});

test("a resource that is not the Application collection has no Argo CD check", () => {
  expect(
    argocdApplicationsCheck(
      { repository, runner: {} as Runner, base: BASE },
      "deployment/argocd-server",
    ),
  ).toBeUndefined();
});

test("the check names the condition it proves", () => {
  const check = argocdApplicationsCheck(
    { repository, runner: {} as Runner, base: BASE },
    RESOURCE,
  );

  expect(check?.condition).toBe("every Application Synced and Healthy");
});

test("every Application Synced and Healthy passes, read-only through kubectl get", async () => {
  const { run, runner } = runnerReturning(
    list(
      { name: "opa-authorizer", sync: "Synced", health: "Healthy" },
      { name: "kore-platform-config", sync: "Synced", health: "Healthy" },
    ),
  );

  await argocdApplicationsCheck(
    { repository, runner, base: BASE },
    RESOURCE,
  )?.run("10m");

  expect(pollUntil).toHaveBeenCalledWith("10m", expect.any(Function));
  expect(run).toHaveBeenCalledTimes(1);
  expect(run).toHaveBeenCalledWith(
    "kubectl",
    [...BASE, "get", RESOURCE, "--output", "json"],
    { capture: true },
  );
});

test("no Application yet passes, since only the Applications that exist are gated", async () => {
  const { runner } = runnerReturning(list());

  await expect(
    argocdApplicationsCheck({ repository, runner, base: BASE }, RESOURCE)?.run(
      "3s",
    ),
  ).resolves.toBeUndefined();
});

test("an OutOfSync Application fails closed and names it with its sync and health", async () => {
  const { runner } = runnerReturning(
    list(
      { name: "opa-authorizer", sync: "Synced", health: "Healthy" },
      { name: "kore-policy-templates", sync: "OutOfSync", health: "Healthy" },
    ),
  );

  await expect(
    argocdApplicationsCheck({ repository, runner, base: BASE }, RESOURCE)?.run(
      "3s",
    ),
  ).rejects.toThrow(
    "Application kore-policy-templates is OutOfSync and Healthy; run kubectl --context k3d-kore-local -n argocd describe application kore-policy-templates",
  );
});

test("a Degraded Application names the health message as the cause", async () => {
  const { runner } = runnerReturning(
    list({
      name: "kore-postgresql-api",
      sync: "Synced",
      health: "Degraded",
      healthMessage:
        "Deployment has exceeded its progress deadline; run kubectl --context k3d-kore-local -n argocd describe application kore-postgresql-api",
    }),
  );

  await expect(
    argocdApplicationsCheck({ repository, runner, base: BASE }, RESOURCE)?.run(
      "3s",
    ),
  ).rejects.toThrow(
    "Application kore-postgresql-api is Synced and Degraded: Deployment has exceeded its progress deadline; run kubectl --context k3d-kore-local -n argocd describe application kore-postgresql-api",
  );
});

test("a failed sync names the condition message when no health message exists", async () => {
  const { runner } = runnerReturning(
    list({
      name: "kore-local-tls",
      sync: "OutOfSync",
      health: "Missing",
      conditions: [
        { type: "ComparisonError", message: "chart digest is not signed" },
      ],
    }),
  );

  await expect(
    argocdApplicationsCheck({ repository, runner, base: BASE }, RESOURCE)?.run(
      "3s",
    ),
  ).rejects.toThrow(
    "Application kore-local-tls is OutOfSync and Missing: chart digest is not signed; run kubectl --context k3d-kore-local -n argocd describe application kore-local-tls",
  );
});

test("an Application that reports no status yet is Unknown, never assumed healthy", async () => {
  const { runner } = runnerReturning(list({ name: "kore-storage" }));

  await expect(
    argocdApplicationsCheck({ repository, runner, base: BASE }, RESOURCE)?.run(
      "3s",
    ),
  ).rejects.toThrow(
    "Application kore-storage is Unknown and Unknown; run kubectl --context k3d-kore-local -n argocd describe application kore-storage",
  );
});

test("every failing Application is named, joined in one reason", async () => {
  const { runner } = runnerReturning(
    list(
      { name: "a", sync: "OutOfSync", health: "Healthy" },
      { name: "b", sync: "Synced", health: "Progressing" },
    ),
  );

  await expect(
    argocdApplicationsCheck({ repository, runner, base: BASE }, RESOURCE)?.run(
      "3s",
    ),
  ).rejects.toThrow(
    "Application a is OutOfSync and Healthy; run kubectl --context k3d-kore-local -n argocd describe application a; Application b is Synced and Progressing; run kubectl --context k3d-kore-local -n argocd describe application b",
  );
});

test("unparseable kubectl output is not ready with a message naming the cause, never ready and never a thrown parse error", async () => {
  const { runner } = runnerReturning("ready");

  await expect(
    argocdApplicationsCheck({ repository, runner, base: BASE }, RESOURCE)?.run(
      "3s",
    ),
  ).rejects.toThrow(
    "kubectl get applications.argoproj.io returned output that is not a JSON Application list, so Application health is unknown; run kubectl --context k3d-kore-local -n argocd get applications.argoproj.io",
  );
});

test("a JSON answer without an item list is not ready either", async () => {
  const { runner } = runnerReturning("null");

  await expect(
    argocdApplicationsCheck({ repository, runner, base: BASE }, RESOURCE)?.run(
      "3s",
    ),
  ).rejects.toThrow(
    "kubectl get applications.argoproj.io returned output that is not a JSON Application list, so Application health is unknown; run kubectl --context k3d-kore-local -n argocd get applications.argoproj.io",
  );
});

test("waitForApplications polls the Application list within the bound it is given, and fails naming the Application that is not Synced and Healthy", async () => {
  const { run, runner } = runnerReturning(
    list({
      name: "golden-path-example",
      sync: "Synced",
      health: "Progressing",
    }),
  );

  await expect(
    waitForApplications({ repository, runner, base: BASE }, "5m"),
  ).rejects.toThrow(
    "Application golden-path-example is Synced and Progressing; run kubectl --context k3d-kore-local -n argocd describe application golden-path-example",
  );

  expect(pollUntil).toHaveBeenCalledWith("5m", expect.any(Function));
  expect(run).toHaveBeenCalledWith(
    "kubectl",
    [...BASE, "get", RESOURCE, "--output", "json"],
    { capture: true },
  );
});

test.each([
  ["a null item", '{"items":[null]}'],
  ["an item without metadata", '{"items":[{"status":{}}]}'],
  ["an item without a name", '{"items":[{"metadata":{}}]}'],
])(
  "%s is not a JSON Application list: not ready, never a thrown TypeError",
  async (_name, stdout) => {
    const { runner } = runnerReturning(stdout);

    await expect(
      argocdApplicationsCheck(
        { repository, runner, base: BASE },
        RESOURCE,
      )?.run("3s"),
    ).rejects.toThrow(
      "kubectl get applications.argoproj.io returned output that is not a JSON Application list, so Application health is unknown; run kubectl --context k3d-kore-local -n argocd get applications.argoproj.io",
    );
  },
);

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
  stdout: list({ name: "opa-authorizer", sync: "Synced", health: "Healthy" }),
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
