import assert from "node:assert/strict";
import { test, vi } from "vitest";

vi.mock("../images/index.js", () => ({
  ensureLocalSigningPublicKey: async () => undefined,
  ensureRegistryAuth: async () => undefined,
  ensureRegistryTrust: async () => undefined,
  registryTrustProblem: async () => undefined,
}));
vi.mock("./admission-gate.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./admission-gate.js")>()),
  closeExistingAdmissionGate: async () => undefined,
}));
vi.mock("./registry-rewire.js", () => ({
  rewireRegistryService: async () => false,
}));
import {
  loadRepository,
  type Component,
  type Repository,
} from "../config/index.js";
import { CommandError, type Runner } from "../runtime/index.js";
import { bootstrapControllers } from "./bootstrap.js";
import { enrollPlatformNamespaces } from "./enrollment.js";
import { desiredFingerprint } from "./fingerprint.js";
import { reconcileComponent } from "./reconcile.js";
import { crashLoop, pod, Scenario } from "./fail-fast-fixtures.js";

const agentgateway = /agentgateway/;

/** The real catalog entries agentgateway depends on, plus itself. */
const involved = [
  "kore-gateway-api",
  "cert-manager",
  "agentgateway-crds",
  "agentgateway",
];

/**
 * The local overlay with the ingress flag set. The catalog is cut to
 * agentgateway and its prerequisites, which keep their real dependency edges;
 * only the prerequisites' readiness is simplified, since their own proofs are
 * not under test here.
 */
async function local(on: boolean): Promise<Repository> {
  const base = await loadRepository("local");
  const sibling = {
    ...base.catalog.components.find((c) => c.kind === "helm")!,
    name: "sibling",
    namespace: "sibling-ns",
    phase: "core" as const,
    dependencies: [],
    ownsCRDs: [],
    readiness: ["configmap/ready"],
  };
  const components = base.catalog.components
    .filter((c) => involved.includes(c.name))
    .map((c) => {
      const kept = c.dependencies.filter((d) => involved.includes(d));
      const prerequisite = !c.name.startsWith("agentgateway");
      return {
        ...c,
        dependencies: kept,
        ...(prerequisite
          ? { readiness: ["configmap/ready"], ownsCRDs: [] }
          : {}),
      };
    });
  return {
    ...base,
    catalog: { ...base.catalog, components: [sibling, ...components] },
    environment: {
      ...base.environment,
      provider: "managed",
      features: { ...base.environment.features, "ingress-agentgateway": on },
    },
  };
}

function component(repository: Repository, name: string): Component {
  return repository.catalog.components.find((c) => c.name === name)!;
}

/**
 * A cluster whose releases are all absent (`converged` false) or all deployed
 * from the current desired state (`converged` true). Gated-off releases are
 * never installed, so Helm answers not found for them in both cases.
 */
function cluster(repository: Repository, converged: boolean) {
  const calls: string[] = [];
  const runner: Runner = {
    async run(command, args) {
      calls.push(`${command} ${args.join(" ")}`);
      if (command !== "helm") {
        return { stdout: kubectlAnswer(args.join(" ")), stderr: "", code: 0 };
      }
      const name = args[1]!;
      const gatedOff =
        agentgateway.test(name) &&
        repository.environment.features?.["ingress-agentgateway"] !== true;
      if (args[0] === "status" || args[0] === "history") {
        if (gatedOff || !converged) {
          throw new CommandError(command, args, {
            stdout: "",
            stderr: "Error: release: not found",
            code: 1,
          });
        }
        const found = repository.catalog.components.find(
          (c) => c.name === name,
        );
        return {
          stdout:
            args[0] === "status"
              ? JSON.stringify({ info: { status: "deployed" } })
              : JSON.stringify([
                  {
                    status: "deployed",
                    description: found
                      ? desiredFingerprint(repository, found)
                      : "",
                  },
                ]),
          stderr: "",
          code: 0,
        };
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  };
  return { runner, calls };
}

/** What the readiness probes read back from a healthy cluster. */
function kubectlAnswer(joined: string): string {
  if (joined.includes("availableReplicas")) {
    return "available";
  }
  return joined.includes("tls.crt") ? "ready" : "";
}

const upgrades = (calls: string[]) =>
  calls
    .filter((c) => c.startsWith("helm upgrade"))
    .map((c) => /upgrade --install (\S+)/.exec(c)![1]!);

test("with the flag off, bootstrap issues no agentgateway command beyond the release probe", async () => {
  const repository = await local(false);
  const { runner, calls } = cluster(repository, false);
  await bootstrapControllers(repository, runner);
  assert.ok(upgrades(calls).length > 0, "the rest of the platform installs");
  assert.deepEqual(
    calls
      .map((c) => c.replaceAll(repository.root, "<root>"))
      .filter((c) => agentgateway.test(c) && !c.startsWith("helm status ")),
    [],
  );
});

test("with the flag on, the CRDs install before the controller, after their dependencies", async () => {
  const repository = await local(true);
  const { runner, calls } = cluster(repository, false);
  await bootstrapControllers(repository, runner);
  const order = upgrades(calls);
  const at = (name: string) => order.indexOf(name);
  assert.ok(at("agentgateway-crds") >= 0 && at("agentgateway") >= 0);
  assert.ok(at("kore-gateway-api") < at("agentgateway-crds"));
  assert.ok(at("agentgateway-crds") < at("agentgateway"));
  assert.ok(at("cert-manager") < at("agentgateway"));
});

test("the controller install waits for its Deployment, and the CRDs wait for the CRDs", async () => {
  const repository = await local(true);
  const { runner, calls } = cluster(repository, false);
  await bootstrapControllers(repository, runner);
  const install = calls.findIndex((c) =>
    c.startsWith("helm upgrade --install agentgateway "),
  );
  assert.ok(install >= 0);
  const after = calls.slice(install + 1);
  assert.ok(
    after.some(
      (c) =>
        c.includes("deployment/agentgateway") &&
        c.includes("agentgateway-system"),
    ),
    "readiness waits on deployment/agentgateway in agentgateway-system",
  );
  const crds = calls.findIndex((c) =>
    c.startsWith("helm upgrade --install agentgateway-crds "),
  );
  assert.ok(
    calls
      .slice(crds + 1, install)
      .some((c) => c.includes("agentgatewaypolicies.agentgateway.dev")),
    "the CRDs are established before the controller installs",
  );
});

test("rerunning bootstrap on a converged cluster changes no Helm release", async () => {
  const repository = await local(true);
  const { runner, calls } = cluster(repository, true);
  await bootstrapControllers(repository, runner);
  assert.deepEqual(upgrades(calls), []);
  assert.deepEqual(
    calls.filter((c) => /^helm (uninstall|rollback)/.test(c)),
    [],
  );
});

test("an unready agentgateway controller names the pod and container, never a bare timeout", async () => {
  const repository = await local(true);
  const target = component(repository, "agentgateway");
  const scenario = new Scenario(() => [
    pod({
      name: "agentgateway-x",
      labels: { "app.kubernetes.io/instance": "agentgateway" },
      containers: [crashLoop(3)],
    }),
  ]);
  await assert.rejects(
    reconcileComponent(repository, scenario, target, undefined, {
      clock: scenario.clock,
      intervalMs: 5000,
      graceMs: 60000,
    }),
    (error: Error) =>
      /component agentgateway failed: pod agentgateway-x container registry CrashLoopBackOff/.test(
        error.message,
      ) && !/timed out/i.test(error.message),
  );
  assert.equal(scenario.aborts, 1, "helm is cancelled, not waited out");
});

test("a failed agentgateway Helm install names the component and the namespace to inspect", async () => {
  const repository = await local(true);
  const target = component(repository, "agentgateway");
  const runner: Runner = {
    async run(command, args) {
      if (command === "helm" && args[0] === "upgrade") {
        throw new CommandError(command, args, {
          stdout: "",
          stderr: "Error: INSTALLATION FAILED: manifest unreachable",
          code: 1,
        });
      }
      return { stdout: "[]", stderr: "", code: 0 };
    },
  };
  await assert.rejects(
    reconcileComponent(repository, runner, target),
    /component agentgateway failed to become ready: .*(manifest unreachable|helm)/s,
  );
});

/** Enrolls under enforce on a converged cluster; returns the namespaces labelled. */
async function enrolled(on: boolean): Promise<string[]> {
  const repository = await local(on);
  repository.environment.imageInventory = "enforce";
  const { runner: base } = cluster(repository, true);
  const labelled: string[] = [];
  const runner: Runner = {
    async run(command, args, options) {
      if (command === "helm") {
        return base.run(command, args, options);
      }
      if (args.includes("namespaces")) {
        const items = repository.catalog.components.map((c) => ({
          metadata: { name: c.namespace, labels: {}, managedFields: [] },
        }));
        return { stdout: JSON.stringify({ items }), stderr: "", code: 0 };
      }
      if (args.includes("apply")) {
        labelled.push(/name: (\S+)/.exec(options?.input ?? "")![1]!);
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  };
  await enrollPlatformNamespaces(repository, runner);
  return labelled;
}

test("agentgateway-system is enrolled in image admission by default, with no exemption", async () => {
  for (const name of ["local", "managed-example"]) {
    const base = await loadRepository(name);
    assert.equal(
      base.environment.enrollmentExemptions?.["agentgateway-system"],
      undefined,
    );
  }
  assert.ok((await enrolled(true)).includes("agentgateway-system"));
  assert.ok(!(await enrolled(false)).includes("agentgateway-system"));
});
