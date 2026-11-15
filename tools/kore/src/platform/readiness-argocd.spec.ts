import { beforeEach, expect, test, vi } from "vitest";
import type { Runner } from "../runtime/index.js";
import { argocdApplicationsCheck } from "./readiness-argocd.js";
import { pollUntil } from "./readiness-poll.js";

vi.mock("./readiness-poll.js");

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
      { runner: {} as Runner, base: BASE },
      "deployment/argocd-server",
    ),
  ).toBeUndefined();
});

test("the check names the condition it proves", () => {
  const check = argocdApplicationsCheck(
    { runner: {} as Runner, base: BASE },
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

  await argocdApplicationsCheck({ runner, base: BASE }, RESOURCE)?.run("10m");

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
    argocdApplicationsCheck({ runner, base: BASE }, RESOURCE)?.run("3s"),
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
    argocdApplicationsCheck({ runner, base: BASE }, RESOURCE)?.run("3s"),
  ).rejects.toThrow(
    "Application kore-policy-templates is OutOfSync and Healthy",
  );
});

test("a Degraded Application names the health message as the cause", async () => {
  const { runner } = runnerReturning(
    list({
      name: "kore-postgresql-api",
      sync: "Synced",
      health: "Degraded",
      healthMessage: "Deployment has exceeded its progress deadline",
    }),
  );

  await expect(
    argocdApplicationsCheck({ runner, base: BASE }, RESOURCE)?.run("3s"),
  ).rejects.toThrow(
    "Application kore-postgresql-api is Synced and Degraded: Deployment has exceeded its progress deadline",
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
    argocdApplicationsCheck({ runner, base: BASE }, RESOURCE)?.run("3s"),
  ).rejects.toThrow(
    "Application kore-local-tls is OutOfSync and Missing: chart digest is not signed",
  );
});

test("an Application that reports no status yet is Unknown, never assumed healthy", async () => {
  const { runner } = runnerReturning(list({ name: "kore-storage" }));

  await expect(
    argocdApplicationsCheck({ runner, base: BASE }, RESOURCE)?.run("3s"),
  ).rejects.toThrow("Application kore-storage is Unknown and Unknown");
});

test("every failing Application is named, joined in one reason", async () => {
  const { runner } = runnerReturning(
    list(
      { name: "a", sync: "OutOfSync", health: "Healthy" },
      { name: "b", sync: "Synced", health: "Progressing" },
    ),
  );

  await expect(
    argocdApplicationsCheck({ runner, base: BASE }, RESOURCE)?.run("3s"),
  ).rejects.toThrow(
    "Application a is OutOfSync and Healthy; Application b is Synced and Progressing",
  );
});
