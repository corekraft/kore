import type { Repository } from "../config/index.js";
import { beforeEach, expect, test, vi } from "vitest";
import { enabledComponents } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { fakeComponent, fakeRepository } from "./platform-support.js";
import { readinessFailure } from "./readiness.js";

// The component readiness path (issue 1880): kore-config-delivery's own readiness
// reads the Application collection through readinessFailure, not the handover
// wait, so the platform scope must reach it too while the sign-in waits for the
// portal. Only the enabled components and the poll are replaced.

vi.mock("../config/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../config/index.js")>()),
  enabledComponents: vi.fn(),
}));
vi.mock("./readiness-poll.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./readiness-poll.js")>()),
  // One probe, the same reason a real poll would fail with.
  pollUntil: vi.fn(
    async (_timeout: string, probe: () => Promise<string | undefined>) => {
      const reason = await probe();
      if (reason !== undefined) {
        throw new Error(reason);
      }
    },
  ),
}));

const delivery = fakeComponent({
  name: "kore-config-delivery",
  phase: "configuration",
  namespace: "argocd",
  timeout: "5m",
  readiness: ["applications.argoproj.io"],
});
const keycloak = fakeComponent({
  name: "kore-platform-keycloak",
  phase: "configuration",
  namespace: "keycloak",
  timeout: "10m",
  startsAfterDelivery: true,
});

const signinOn = {
  "golden-path-signin": true,
  "portal-staged-install": true,
  "golden-path-signin-after-portal": true,
};

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

const goldenPathDegraded: App = {
  name: "golden-path-example",
  labelled: true,
  sync: "Synced",
  health: "Degraded",
};
const platformDegraded: App = {
  name: "kore-postgresql-api",
  sync: "Synced",
  health: "Degraded",
};
const platformHealthy: App = {
  name: "opa-authorizer",
  sync: "Synced",
  health: "Healthy",
};

/** The component's readiness, read with the repository's flags and the given Application list. */
function readinessWith(
  features: Record<string, boolean>,
  apps: string,
  enabled = [delivery, keycloak],
): Promise<string | undefined> {
  vi.mocked(enabledComponents).mockReturnValue(enabled);
  const repository: Repository = fakeRepository({
    kubeContext: "k3d-kore-local",
    features,
  });
  const runner: Runner = {
    run: vi.fn(async () => ({ stdout: apps, stderr: "", code: 0 })),
  } as unknown as Runner;
  return readinessFailure(repository, runner, delivery);
}

beforeEach(() => {
  vi.mocked(enabledComponents).mockReset();
});

test("with the sign-in waiting for the portal, a golden-path Application that is Degraded does not fail the component's readiness", async () => {
  await expect(
    readinessWith(signinOn, list(platformHealthy, goldenPathDegraded)),
  ).resolves.toBeUndefined();
});

test("with the sign-in waiting for the portal, a platform Application that is Degraded still fails the component's readiness, naming it", async () => {
  const failure = await readinessWith(
    signinOn,
    list(platformHealthy, platformDegraded, goldenPathDegraded),
  );
  expect(failure).toContain(
    "Application kore-postgresql-api is Synced and Degraded",
  );
  expect(failure).not.toContain("golden-path-example");
});

test("with golden-path-signin-after-portal off, the component's readiness still waits on the golden-path Application, as before", async () => {
  const failure = await readinessWith(
    { ...signinOn, "golden-path-signin-after-portal": false },
    list(platformHealthy, goldenPathDegraded),
  );
  expect(failure).toContain(
    "Application golden-path-example is Synced and Degraded",
  );
});

test("with portal-staged-install off, the component's readiness still waits on the golden-path Application", async () => {
  const failure = await readinessWith(
    { ...signinOn, "portal-staged-install": false },
    list(goldenPathDegraded),
  );
  expect(failure).toContain("golden-path-example");
});

test("with no platform Keycloak enabled, nothing is deferred and the golden-path Application still gates", async () => {
  const failure = await readinessWith(signinOn, list(goldenPathDegraded), [
    delivery,
  ]);
  expect(failure).toContain("golden-path-example");
});
