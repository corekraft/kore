import assert from "node:assert/strict";
import { test, vi } from "vitest";

vi.mock("../../src/images/index.js", () => ({
  ensureRegistryAuth: async () => undefined,
  ensureRegistryTrust: async () => undefined,
  ensureLocalSigningPublicKey: async () => undefined,
  registryTrustProblem: async () => undefined,
}));
import {
  loadRepository,
  type Component,
  type Repository,
} from "../../src/config/index.js";
import { CommandError, type Runner } from "../../src/runtime/index.js";
import {
  bootstrapControllers,
  enrollPlatformNamespaces,
  evaluateReadiness,
  managedNamespaces,
  platformGeneration,
  platformStatus,
  uninstallGatedRelease,
} from "../../src/testing/index.js";

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
    /kore platform uninstall gated --environment \S+ --yes/,
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
    /gated.*kore platform uninstall gated --environment \S+ --yes.*feature ingress/s,
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
      {
        name: "ingress",
        step: 1,
        capability: "controller",
        components: ["gated"],
      },
      {
        name: "base",
        step: 2,
        capability: "controller",
        components: ["sibling"],
      },
    ],
  };
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

test("uninstall without --yes removes nothing and names the release it would remove", async () => {
  const repository = await repositoryWith(false);
  const { runner, calls } = cluster(true);
  await assert.rejects(
    uninstallGatedRelease(repository, runner, "gated", {
      yes: false,
      purgeData: false,
    }),
    /would uninstall release gated from namespace gated-ns in kube context \S+\. Nothing was removed/,
  );
  assert.ok(calls.every((call) => !call.startsWith("helm uninstall")));
});

test("uninstall with --yes runs exactly one helm uninstall of the named release, in the environment's context, and nothing else that mutates", async () => {
  const repository = await repositoryWith(false);
  const { runner, calls } = cluster(true);
  let installed = true;
  const stateful: Runner = {
    async run(command, args, options) {
      if (command === "helm" && args[0] === "uninstall") {
        calls.push(`${command} ${args.join(" ")}`);
        installed = false;
        return { stdout: "", stderr: "", code: 0 };
      }
      if (
        command === "helm" &&
        args[0] === "status" &&
        args[1] === "gated" &&
        !installed
      ) {
        throw new CommandError(command, args, {
          stdout: "",
          stderr: "Error: release: not found",
          code: 1,
        });
      }
      return runner.run(command, args, options);
    },
  };
  const { timeout } = repository.catalog.components.find(
    (component) => component.name === "gated",
  )!;

  const result = await uninstallGatedRelease(repository, stateful, "gated", {
    yes: true,
    purgeData: false,
  });

  assert.deepEqual(result, {
    status: "uninstalled",
    name: "gated",
    namespace: "gated-ns",
  });
  assert.deepEqual(
    calls.filter((call) =>
      /^helm (uninstall|rollback|upgrade)|delete /.test(call),
    ),
    [
      `helm uninstall gated --namespace gated-ns --kube-context ${repository.environment.kubeContext} --wait --timeout ${timeout}`,
    ],
  );
});
