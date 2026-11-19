import { expect, test } from "vitest";
import {
  enabledComponents,
  loadRepository,
  platformArgocdDeliveryFlag,
} from "../../src/config/index.js";
import { platformStatus } from "../../src/platform/index.js";
import { CommandError, type Runner } from "../../src/runtime/index.js";

// Docs: docs/decisions/0043-platform-configuration-through-argo-cd.md

const APPLICATIONS = JSON.stringify({
  items: [
    {
      metadata: { name: "kore-local-tls" },
      status: {
        sync: { status: "OutOfSync" },
        health: { status: "Missing" },
        conditions: [{ message: "chart digest is not signed" }],
      },
    },
  ],
});

function kubectlOutput(line: string, applications: string): string {
  if (line.includes("get applications.argoproj.io")) {
    return applications;
  }
  return line.includes("availableReplicas") ? "available" : "";
}

/** A cluster whose Argo CD is installed and Ready; Helm has no gated-off release. */
function cluster(applications: string, installed = true) {
  const calls: string[][] = [];
  const runner: Runner = {
    async run(command, args) {
      calls.push([command, ...args]);
      const line = args.join(" ");
      if (
        installed &&
        command === "helm" &&
        /^status (argocd|kore-config-delivery) /.test(line)
      ) {
        return {
          stdout: JSON.stringify({ info: { status: "deployed" } }),
          stderr: "",
          code: 0,
        };
      }
      if (command === "helm") {
        throw new CommandError(command, args, {
          stdout: "",
          stderr: "Error: release: not found",
          code: 1,
        });
      }
      return { stdout: kubectlOutput(line, applications), stderr: "", code: 0 };
    },
  };
  return { runner, calls };
}

async function repositoryWith(flag: boolean) {
  const repository = await loadRepository("local");
  return {
    ...repository,
    environment: {
      ...repository.environment,
      features: {
        ...repository.environment.features,
        [platformArgocdDeliveryFlag]: flag,
      },
    },
  };
}

const DELIVERY_FAILURE =
  "applications.argoproj.io not ready (every Application Synced and Healthy) within 3s: Application kore-local-tls is OutOfSync and Missing: chart digest is not signed; run kubectl --context k3d-kore-local -n argocd describe application kore-local-tls";

test("with the flag on, an unhealthy Application degrades kore-config-delivery naming the Application and its cause, not Argo CD", async () => {
  const { runner } = cluster(APPLICATIONS);

  const rows = await platformStatus(await repositoryWith(true), runner, [
    "argocd",
    "kore-config-delivery",
  ]);

  expect(rows).toEqual([
    {
      name: "argocd",
      namespace: "argocd",
      status: "ready",
      detail: "installed and ready",
    },
    {
      name: "kore-config-delivery",
      namespace: "argocd",
      status: "degraded",
      detail: DELIVERY_FAILURE,
    },
  ]);
});

test("only the delivery release, reconciled in the configuration phase, waits on Application health, so a rerun can repair a failed delivery before any Application wait", async () => {
  const waiting = enabledComponents(await repositoryWith(true))
    .filter(({ readiness }) => readiness.includes("applications.argoproj.io"))
    .map(({ name, phase }) => ({ name, phase }));

  expect(waiting).toEqual([
    { name: "kore-config-delivery", phase: "configuration" },
  ]);
});

test("with the flag on, Argo CD is ready when every Application is Synced and Healthy", async () => {
  const healthy = JSON.stringify({
    items: [
      {
        metadata: { name: "opa-authorizer" },
        status: { sync: { status: "Synced" }, health: { status: "Healthy" } },
      },
    ],
  });
  const { runner } = cluster(healthy);

  const rows = await platformStatus(await repositoryWith(true), runner, [
    "argocd",
  ]);

  expect(rows.map(({ status }) => status)).toEqual(["ready"]);
});

test("with the flag off, Argo CD is gated off and no Application is ever read", async () => {
  const { runner, calls } = cluster(APPLICATIONS, false);

  const rows = await platformStatus(await repositoryWith(false), runner, [
    "argocd",
  ]);

  expect(rows.map(({ status }) => status)).toEqual(["gated-off"]);
  expect(calls.some((call) => call.includes("applications.argoproj.io"))).toBe(
    false,
  );
});
