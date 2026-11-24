import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
import {
  componentValues,
  gatewayClassName,
  loadRepository,
  type Repository,
} from "../../src/config/index.js";
import { render } from "./gateway-service-support.js";
import {
  documents,
  overlays,
  podSpecOf,
  renderComponent,
  withQos,
  type Doc,
  type PodSpec,
} from "./data-path-qos-support.js";

// Docs: docs/decisions/0152-one-node-capacity-is-a-declared-budget-that-quotas-enforce-and-memory-favours-the-cluster.md
// Issue 1531: with data-path-priority-class on, one kore-owned PriorityClass below the built-in system classes
// is created once, by the registry release, and the gateway proxy, platform DNS, the policy controller and the
// registry name it. Off, nothing is rendered and no pod names a class. Apps keep the default class.

const flag = "data-path-priority-class";
const className = "kore-platform-critical";
const builtIns = [2000000000, 2000001000];

/** The repository with the priority-class flag set as given; the rest as the overlay has them. */
function withPriority(repository: Repository, on: boolean): Repository {
  return {
    ...repository,
    environment: {
      ...repository.environment,
      features: { ...repository.environment.features, [flag]: on },
    },
  };
}

/** A PriorityClass as the registry release renders it. */
interface PriorityClassDoc {
  kind?: string;
  metadata?: { name?: string };
  value?: number;
  globalDefault?: boolean;
}

/** The priority class a pod spec names; absent when it names none. */
function priorityOf(podSpec: PodSpec | undefined): string | undefined {
  return (podSpec as { priorityClassName?: string } | undefined)
    ?.priorityClassName;
}

/** Every PriorityClass a render holds. */
function priorityClassesOf(text: string): PriorityClassDoc[] {
  return (documents(text) as PriorityClassDoc[]).filter(
    (doc) => doc.kind === "PriorityClass",
  );
}

/** The pod spec of the registry Deployment, found by its name. */
function registryPod(text: string): PodSpec {
  return podSpecOf(documents(text), "Deployment", "oci-registry");
}

/** The priority class the gateway overlay gives the proxy, for either class; undefined when it sets none. */
function gatewayPriority(
  repository: Repository,
  output: string,
): string | undefined {
  const docs = documents(output);
  if (gatewayClassName(repository.environment) === "istio") {
    const configMap = docs.find(
      (doc) =>
        doc.kind === "ConfigMap" &&
        doc.metadata?.name === "kore-gateway-service",
    );
    const patch = configMap?.data?.deployment;
    if (patch === undefined) {
      return undefined;
    }
    return priorityOf(documents(patch)[0]?.spec?.template?.spec);
  }
  const parameters = docs.find(
    (doc) =>
      doc.kind === "AgentgatewayParameters" &&
      doc.metadata?.name === "kore-gateway-service",
  ) as
    | (Doc & {
        spec?: { deployment?: { spec?: { template?: { spec?: PodSpec } } } };
      })
    | undefined;
  return priorityOf(parameters?.spec?.deployment?.spec?.template?.spec);
}

/** The keys the policy controller's priority values file sets. */
interface PriorityValues {
  webhook?: { priorityClass?: string };
  leasescleanup?: { priorityClass?: string };
}

function priorityValuesOf(repository: Repository): PriorityValues {
  const component = repository.catalog.components.find(
    (c) => c.name === "policy-controller",
  );
  assert.ok(component, "the catalog has the policy-controller component");
  const file = componentValues(repository, component).find((path) =>
    path.endsWith("policy-controller-priority.yaml"),
  );
  assert.ok(file, "the policy controller takes its priority values file");
  return JSON.parse(
    execFileSync("yq", ["-o=json", "-I=0", "."], {
      input: readFileSync(join(repository.root, file), "utf8"),
      encoding: "utf8",
    }),
  ) as PriorityValues;
}

// Flag off: nothing kore-owned is rendered and no pod names a class.

test("flag off: no PriorityClass is rendered and no pod or gateway overlay names one", async () => {
  for (const name of overlays) {
    const repository = withPriority(await loadRepository(name), false);
    const registry = renderComponent(repository, "oci-registry");
    const dns = renderComponent(repository, "kore-platform-dns");
    assert.deepEqual(priorityClassesOf(registry), [], `${name}: registry`);
    assert.deepEqual(priorityClassesOf(dns), [], `${name}: dns`);
    assert.equal(priorityOf(registryPod(registry)), undefined, name);
    assert.equal(
      priorityOf(podSpecOf(documents(dns), "Deployment", "platform-dns")),
      undefined,
      `${name}: platform DNS`,
    );
    assert.equal(
      gatewayPriority(repository, render(repository)),
      undefined,
      `${name}: gateway overlay`,
    );
  }
});

test("flag off: the policy controller takes no priority values file", async () => {
  const repository = withPriority(await loadRepository("local"), false);
  const component = repository.catalog.components.find(
    (c) => c.name === "policy-controller",
  );
  assert.ok(component);
  assert.equal(
    componentValues(repository, component).some((path) =>
      path.endsWith("policy-controller-priority.yaml"),
    ),
    false,
  );
});

// Flag on: one class, owned once, below both built-ins and above apps.

test("flag on: the registry renders exactly one kore PriorityClass, below both built-ins and above the default", async () => {
  for (const name of overlays) {
    const repository = withPriority(await loadRepository(name), true);
    const classes = priorityClassesOf(
      renderComponent(repository, "oci-registry"),
    );
    assert.equal(classes.length, 1, `${name}: one class`);
    const [only] = classes;
    assert.equal(only?.metadata?.name, className, name);
    assert.ok(
      typeof only?.value === "number" && only.value > 0,
      `${name}: above the default of 0`,
    );
    for (const builtIn of builtIns) {
      assert.ok(
        only!.value! < builtIn,
        `${name}: ${only!.value} is below ${builtIn}`,
      );
    }
    assert.notEqual(
      only?.globalDefault,
      true,
      `${name}: not the global default`,
    );
    assert.equal(
      className.startsWith("system-"),
      false,
      "the kore class may not use the reserved system- prefix",
    );
  }
});

test("flag on: the registry pod, platform DNS and the gateway proxy each name the class, and no other release renders one", async () => {
  for (const name of overlays) {
    const repository = withPriority(await loadRepository(name), true);
    const registry = renderComponent(repository, "oci-registry");
    const dns = renderComponent(repository, "kore-platform-dns");
    const config = render(repository);
    assert.equal(
      priorityOf(registryPod(registry)),
      className,
      `${name}: registry`,
    );
    assert.equal(
      priorityOf(podSpecOf(documents(dns), "Deployment", "platform-dns")),
      className,
      `${name}: platform DNS`,
    );
    assert.equal(
      gatewayPriority(repository, config),
      className,
      `${name}: gateway`,
    );
    assert.deepEqual(priorityClassesOf(dns), [], `${name}: DNS owns no class`);
    assert.deepEqual(
      priorityClassesOf(config),
      [],
      `${name}: platform-config owns no class`,
    );
  }
});

test("flag on: the policy controller values name the class on the webhook and the leases-cleanup Job", async () => {
  for (const name of overlays) {
    const repository = withPriority(await loadRepository(name), true);
    const values = priorityValuesOf(repository);
    assert.equal(values.webhook?.priorityClass, className, name);
    assert.equal(values.leasescleanup?.priorityClass, className, name);
  }
});

test("flag on with Guaranteed QoS on too: the gateway proxy keeps its resources and names the class", async () => {
  for (const name of overlays) {
    const repository = withQos(
      withPriority(await loadRepository(name), true),
      true,
    );
    assert.equal(
      gatewayPriority(repository, render(repository)),
      className,
      `${name}: gateway`,
    );
  }
});

test("the priority values file is gated by its own flag, not by the Guaranteed QoS flag", async () => {
  const base = await loadRepository("local");
  const qosOnly = withQos(withPriority(base, false), true);
  const component = base.catalog.components.find(
    (c) => c.name === "policy-controller",
  );
  assert.ok(component);
  assert.equal(
    componentValues(qosOnly, component).some((path) =>
      path.endsWith("policy-controller-priority.yaml"),
    ),
    false,
  );
});
