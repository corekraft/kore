import type { Repository } from "../config/index.js";
import { beforeEach, expect, test, vi } from "vitest";
import type { Runner } from "../runtime/index.js";
import { waitForApplications } from "./readiness-argocd.js";
import { pollUntil } from "./readiness-poll.js";

// The scope of the Application gate (issue 1880): platform Applications are the
// ones without the service label; golden-path Services carry it.

vi.mock("./readiness-poll.js");

const repository = {
  environment: { kubeContext: "k3d-kore-local" },
} as unknown as Repository;
const BASE = ["--context", "kore-local", "--namespace", "argocd"];

interface App {
  name: string;
  labelled?: boolean;
  sync: string;
  health: string;
}

function list(...apps: App[]): string {
  return JSON.stringify({
    items: apps.map((app) => ({
      metadata: {
        name: app.name,
        labels: app.labelled
          ? { "platform.kore.dev/service": app.name }
          : undefined,
      },
      status: { sync: { status: app.sync }, health: { status: app.health } },
    })),
  });
}

function runnerReturning(stdout: string): Runner {
  const run = vi.fn().mockResolvedValue({ stdout, stderr: "", exitCode: 0 });
  return { run } as unknown as Runner;
}

/** Gates like the real poll: one probe, and any reason fails the wait. */
beforeEach(() => {
  vi.mocked(pollUntil).mockReset();
  vi.mocked(pollUntil).mockImplementation(async (_timeout, probe) => {
    const reason = await probe();
    if (reason !== undefined) {
      throw new Error(reason);
    }
  });
});

const degradedService: App = {
  name: "golden-path-example",
  labelled: true,
  sync: "Synced",
  health: "Degraded",
};
const degradedPlatform: App = {
  name: "kore-postgresql-api",
  sync: "Synced",
  health: "Degraded",
};
const healthyPlatform: App = {
  name: "opa-authorizer",
  sync: "Synced",
  health: "Healthy",
};

test("the platform scope passes while a golden-path Service Application is Degraded, since that wait is the later one", async () => {
  const runner = runnerReturning(list(healthyPlatform, degradedService));

  await expect(
    waitForApplications({ repository, runner, base: BASE }, "5m", "platform"),
  ).resolves.toBeUndefined();
});

test("the platform scope still blocks on an unlabelled Degraded Application, naming it", async () => {
  const runner = runnerReturning(
    list(healthyPlatform, degradedPlatform, degradedService),
  );

  await expect(
    waitForApplications({ repository, runner, base: BASE }, "5m", "platform"),
  ).rejects.toThrow("Application kore-postgresql-api is Synced and Degraded");
});

test("the service scope gates only the labelled golden-path Applications", async () => {
  const runner = runnerReturning(
    list(degradedPlatform, { ...degradedService, health: "Healthy" }),
  );

  await expect(
    waitForApplications({ repository, runner, base: BASE }, "10m", "service"),
  ).resolves.toBeUndefined();
});

test("the service scope blocks on a labelled Degraded Application, naming it", async () => {
  const runner = runnerReturning(list(healthyPlatform, degradedService));

  await expect(
    waitForApplications({ repository, runner, base: BASE }, "10m", "service"),
  ).rejects.toThrow("Application golden-path-example is Synced and Degraded");
});

test("the all scope, which is the flag-off gate, blocks on a labelled Degraded Application too", async () => {
  const runner = runnerReturning(list(healthyPlatform, degradedService));

  await expect(
    waitForApplications({ repository, runner, base: BASE }, "5m"),
  ).rejects.toThrow("Application golden-path-example is Synced and Degraded");
});

test("an unlabelled Degraded Application is never excused by a scope that skips labelled ones", async () => {
  const runner = runnerReturning(list(degradedPlatform));

  await expect(
    waitForApplications({ repository, runner, base: BASE }, "10m", "service"),
  ).resolves.toBeUndefined();
  await expect(
    waitForApplications({ repository, runner, base: BASE }, "5m", "platform"),
  ).rejects.toThrow("Application kore-postgresql-api is Synced and Degraded");
});
