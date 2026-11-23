import {
  enabledComponents,
  signinAwaitsPortal,
  type Repository,
} from "../config/index.js";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Runner } from "../runtime/index.js";
import {
  argocdApplicationsCheck,
  waitForApplications,
} from "./readiness-argocd.js";
import { pollUntil } from "./readiness-poll.js";
import { fakeComponent } from "./platform-support.js";

vi.mock("./readiness-poll.js");
vi.mock("../config/index.js");

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

/** The component's own check reads the platform Applications while the sign-in waits for the portal (issue 1880). */
describe("the component's Application check under the golden-path sign-in", () => {
  const keycloak = fakeComponent({ name: "kore-platform-keycloak" });
  const labelled = (name: string, health: string) => ({
    metadata: { name, labels: { "platform.kore.dev/service": name } },
    status: { sync: { status: "Synced" }, health: { status: health } },
  });
  const plain = (name: string, health: string) => ({
    metadata: { name },
    status: { sync: { status: "Synced" }, health: { status: health } },
  });
  const apps = (...items: unknown[]) =>
    runnerReturning(JSON.stringify({ items }));

  /** Runs the component's check over the given Applications with the given deferral and Keycloak. */
  function componentCheck(
    deferred: boolean,
    enabled: unknown[],
    items: unknown[],
  ): Promise<void> {
    vi.mocked(signinAwaitsPortal).mockReturnValue(deferred);
    vi.mocked(enabledComponents).mockReturnValue(enabled as never);
    const { runner } = apps(...items);
    return (
      argocdApplicationsCheck(
        { repository, runner, base: BASE },
        RESOURCE,
      )?.run("5m") ?? Promise.resolve()
    );
  }

  test("while the sign-in waits for the portal, a golden-path Application that is Degraded passes the component's check", async () => {
    await expect(
      componentCheck(
        true,
        [keycloak],
        [plain("opa", "Healthy"), labelled("golden-path-example", "Degraded")],
      ),
    ).resolves.toBeUndefined();
  });

  test("while the sign-in waits for the portal, a platform Application that is Degraded still fails the component's check", async () => {
    await expect(
      componentCheck(
        true,
        [keycloak],
        [
          plain("kore-postgresql-api", "Degraded"),
          labelled("golden-path-example", "Degraded"),
        ],
      ),
    ).rejects.toThrow("Application kore-postgresql-api is Synced and Degraded");
  });

  test("when the sign-in is not deferred, a golden-path Application that is Degraded still fails the component's check", async () => {
    await expect(
      componentCheck(
        false,
        [keycloak],
        [labelled("golden-path-example", "Degraded")],
      ),
    ).rejects.toThrow("Application golden-path-example is Synced and Degraded");
  });

  test("with no platform Keycloak enabled, nothing is deferred and a golden-path Application that is Degraded still fails", async () => {
    await expect(
      componentCheck(true, [], [labelled("golden-path-example", "Degraded")]),
    ).rejects.toThrow("Application golden-path-example is Synced and Degraded");
  });
});
