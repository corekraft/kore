import assert from "node:assert/strict";
import { test } from "vitest";
import { gatewayClassName, loadRepository } from "../../src/config/index.js";
import { render } from "./gateway-service-support.js";
import {
  containerNamed,
  containersOf,
  documents,
  gatewayOverlaySizes,
  guaranteed,
  overlays,
  podSpecOf,
  renderComponent,
  withQos,
} from "./data-path-qos-support.js";

// Docs: docs/decisions/0152-one-node-capacity-is-a-declared-budget-that-quotas-enforce-and-memory-favours-the-cluster.md
// Issue 1593: with data-path-guaranteed-qos on, the gateway proxy, platform DNS and the registry (both
// containers) request exactly their limits, so each pod is Guaranteed. Off, each keeps the sizes it renders
// today. The policy controller is checked by its opt-in upstream spec, which pulls the pinned chart.

// Flag off: the sizes each release renders today, unchanged.

test("flag off: the gateway proxy overlay sets no resources on either class, as before", async () => {
  for (const name of overlays) {
    const repository = withQos(await loadRepository(name), false);
    assert.equal(
      gatewayOverlaySizes(repository, render(repository)),
      undefined,
      name,
    );
  }
});

test("flag off: platform DNS keeps its sizes, so its pod is not Guaranteed", async () => {
  const repository = withQos(await loadRepository("local"), false);
  const containers = containersOf(
    podSpecOf(
      documents(renderComponent(repository, "kore-platform-dns")),
      "Deployment",
      "platform-dns",
    ),
  );
  assert.deepEqual(containerNamed(containers, "coredns"), {
    name: "coredns",
    requests: { cpu: "25m", memory: "32Mi" },
    limits: { cpu: "200m", memory: "64Mi" },
  });
  assert.equal(guaranteed(containers), false);
});

test("flag off: the registry keeps its sizes on both containers", async () => {
  const repository = withQos(await loadRepository("local"), false);
  const containers = containersOf(
    podSpecOf(
      documents(renderComponent(repository, "oci-registry")),
      "Deployment",
      "oci-registry",
    ),
  );
  assert.deepEqual(containerNamed(containers, "registry"), {
    name: "registry",
    requests: { cpu: "50m", memory: "128Mi" },
    limits: { cpu: "250m", memory: "512Mi" },
  });
  assert.deepEqual(containerNamed(containers, "proxy"), {
    name: "proxy",
    requests: { cpu: "25m", memory: "32Mi" },
    limits: { cpu: "250m", memory: "128Mi" },
  });
  assert.equal(guaranteed(containers), false);
});

// Flag on: every container of each data-path pod requests its limit.

test("flag on: the gateway proxy requests its limit for CPU and memory, on each class", async () => {
  for (const name of overlays) {
    const repository = withQos(await loadRepository(name), true);
    const sizes = gatewayOverlaySizes(repository, render(repository));
    assert.ok(sizes, `${name} sets the proxy's resources`);
    assert.ok(
      guaranteed([sizes]),
      `${name} (${gatewayClassName(repository.environment)}): ${JSON.stringify(sizes)}`,
    );
  }
});

test("flag on: platform DNS's one container requests its limit, so its pod is Guaranteed", async () => {
  for (const name of overlays) {
    const repository = withQos(await loadRepository(name), true);
    const containers = containersOf(
      podSpecOf(
        documents(renderComponent(repository, "kore-platform-dns")),
        "Deployment",
        "platform-dns",
      ),
    );
    assert.ok(guaranteed(containers), `${name}: ${JSON.stringify(containers)}`);
  }
});

test("flag on: the registry's registry and proxy containers each request their limit, so its pod is Guaranteed", async () => {
  for (const name of overlays) {
    const repository = withQos(await loadRepository(name), true);
    const containers = containersOf(
      podSpecOf(
        documents(renderComponent(repository, "oci-registry")),
        "Deployment",
        "oci-registry",
      ),
    );
    assert.ok(guaranteed(containers), `${name}: ${JSON.stringify(containers)}`);
  }
});
