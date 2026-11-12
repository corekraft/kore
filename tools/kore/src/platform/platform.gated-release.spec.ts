import assert from "node:assert/strict";
import { test, vi } from "vitest";

vi.mock("../images/index.js", () => ({
  ensureRegistryAuth: async () => undefined,
  ensureRegistryTrust: async () => undefined,
  ensureLocalSigningPublicKey: async () => undefined,
  registryTrustProblem: async () => undefined,
}));
vi.mock("./admission-gate.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./admission-gate.js")>()),
  closeExistingAdmissionGate: async () => undefined,
}));
import {
  loadRepository,
  type Component,
  type Repository,
} from "../config/index.js";
import { CommandError, type Runner } from "../runtime/index.js";
import { bootstrapControllers } from "./bootstrap.js";
import { enrollPlatformNamespaces } from "./enrollment.js";
import { platformStatus } from "./status.js";
import { platformGeneration } from "./admission-gate.js";
import { evaluateReadiness } from "./readiness-manifest.js";
import { managedNamespaces } from "./gated-release.js";

const deployed = JSON.stringify({ info: { status: "deployed" } });

async function repositoryWith(on: boolean): Promise<Repository> {
  const base = await loadRepository("managed-example");
  const helm = base.catalog.components.find((c) => c.kind === "helm")!;
  const component = (name: string, namespace: string): Component => ({
    ...helm,
    name,
    namespace,
    phase: "core",
    dependencies: [],
    ownsCRDs: [],
    readiness: ["configmap/ready"],
  });
  return {
    ...base,
    catalog: {
      ...base.catalog,
      components: [
        component("sibling", "sibling-ns"),
        { ...component("gated", "gated-ns"), featureFlag: "ingress" },
      ],
    },
    environment: {
      ...base.environment,
      provider: "managed",
      enrollmentExemptions: {},
      imageInventory: "enforce",
      features: { ingress: on },
    },
  };
}

/** A cluster where the gated release is (or is not) still installed. */
function cluster(releaseInstalled: boolean) {
  const calls: string[] = [];
  const runner: Runner = {
    async run(command, args) {
      calls.push(`${command} ${args.join(" ")}`);
      if (command === "helm" && args[0] === "status") {
        if (args[1] === "gated" && !releaseInstalled) {
          throw new CommandError(command, args, {
            stdout: "",
            stderr: "Error: release: not found",
            code: 1,
          });
        }
        return { stdout: deployed, stderr: "", code: 0 };
      }
      if (command === "helm" && args[0] === "history") {
        return { stdout: "[]", stderr: "", code: 0 };
      }
      if (args.includes("namespaces")) {
        return {
          stdout: JSON.stringify({
            items: ["sibling-ns", "gated-ns"].map((name) => ({
              metadata: { name, labels: {}, managedFields: [] },
            })),
          }),
          stderr: "",
          code: 0,
        };
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  };
  return { runner, calls };
}

test("status reports a gated-off component with no release as gated off", async () => {
  const repository = await repositoryWith(false);
  const { runner } = cluster(false);
  const [row] = await platformStatus(repository, runner, ["gated"]);
  assert.equal(row!.status, "gated-off");
});

test("status reports a gated-off component whose release remains as degraded, with the fix", async () => {
  const repository = await repositoryWith(false);
  const { runner } = cluster(true);
  const [row] = await platformStatus(repository, runner, ["gated"]);
  assert.equal(row!.status, "degraded");
  assert.match(
    row!.detail,
    /helm uninstall gated --namespace gated-ns --kube-context \S+/,
  );
  assert.match(row!.detail, /feature ingress/);
});

test("the release check is read-only", async () => {
  const repository = await repositoryWith(false);
  const { runner, calls } = cluster(true);
  await platformStatus(repository, runner, ["gated"]);
  assert.ok(calls.every((call) => call.startsWith("helm status ")));
});

test("a failure other than not-found is reported degraded, never as gated off", async () => {
  const repository = await repositoryWith(false);
  const runner: Runner = {
    async run(command, args) {
      throw new CommandError(command, args, {
        stdout: "",
        stderr: "Kubernetes cluster unreachable",
        code: 1,
      });
    },
  };
  const [row] = await platformStatus(repository, runner, ["gated"]);
  assert.equal(row!.status, "degraded");
  assert.match(row!.detail, /unreachable/);
});

test("platform bootstrap fails fast, installing nothing, when a gated-off release remains", async () => {
  const repository = await repositoryWith(false);
  const { runner, calls } = cluster(true);
  await assert.rejects(
    bootstrapControllers(repository, runner),
    /gated.*helm uninstall gated --namespace gated-ns --kube-context \S+.*feature ingress/s,
  );
  assert.equal(calls.filter((c) => c.startsWith("helm upgrade")).length, 0);
});

test("bootstrap proceeds when the gated-off release is gone", async () => {
  const repository = await repositoryWith(false);
  const { runner, calls } = cluster(false);
  await bootstrapControllers(repository, runner);
  assert.ok(calls.some((c) => c.includes("sibling")));
});

test("enforce enrollment keeps labelling the namespace of a remaining gated-off release, and drops it once it is gone", async () => {
  const repository = await repositoryWith(false);
  const applied = async (installed: boolean) => {
    const { runner, calls } = cluster(installed);
    await enrollPlatformNamespaces(repository, runner);
    return calls.filter((c) => c.includes(" apply ")).length;
  };
  const withRelease = await applied(true);
  const without = await applied(false);
  assert.equal(withRelease, without + 1);
});

test("the managed namespaces include a remaining gated-off release's namespace", async () => {
  const repository = await repositoryWith(false);
  assert.deepEqual(await managedNamespaces(repository, cluster(true).runner), [
    "gated-ns",
    "sibling-ns",
  ]);
  assert.deepEqual(await managedNamespaces(repository, cluster(false).runner), [
    "sibling-ns",
  ]);
});

test("the platform generation moves when a flag gating a component flips", async () => {
  assert.notEqual(
    platformGeneration(await repositoryWith(false)),
    platformGeneration(await repositoryWith(true)),
  );
});

test("a requirement whose components are all gated off is skipped, not ready", async () => {
  const repository = await repositoryWith(false);
  repository.readiness = {
    ...repository.readiness,
    requirements: [
      { name: "ingress", step: 1, capability: "c", components: ["gated"] },
      { name: "base", step: 2, capability: "c", components: ["sibling"] },
    ],
  } as never;
  const evidence = evaluateReadiness(repository, [
    { name: "gated", namespace: "x", status: "gated-off", detail: "off" },
    { name: "sibling", namespace: "x", status: "ready", detail: "ok" },
  ]);
  assert.equal(evidence.state, "open");
  assert.deepEqual(
    evidence.requirements.map((r) => r.status),
    ["skipped", "ready"],
  );
});
