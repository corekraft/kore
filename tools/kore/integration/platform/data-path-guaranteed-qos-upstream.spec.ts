import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository } from "../../src/config/index.js";
import {
  containerNamed,
  containersOf,
  documents,
  find,
  guaranteed,
  renderComponent,
  withQos,
} from "./data-path-qos-support.js";

// Docs: docs/decisions/0152-one-node-capacity-is-a-declared-budget-that-quotas-enforce-and-memory-favours-the-cluster.md
// Opt-in: it pulls the pinned policy-controller chart, and fast tests run offline (AGENTS.md).
// Run with `npm run test:upstream-charts` when bumping policy-controller.
// Issue 1593: with data-path-guaranteed-qos on, the webhook and the leases-cleanup Job each request their limit.

const run = test.runIf(process.env["KORE_CHECK_UPSTREAM_CHARTS"] === "1");

run(
  "flag off: the policy controller keeps the chart's own sizes, and the cleanup Job none",
  async () => {
    const repository = withQos(await loadRepository("local"), false);
    const docs = documents(renderComponent(repository, "policy-controller"));
    const webhook = containersOf(
      find(docs, "Deployment", "policy-controller-webhook").spec.template.spec,
    );
    assert.deepEqual(containerNamed(webhook, "policy-controller-webhook"), {
      name: "policy-controller-webhook",
      requests: { cpu: "100m", memory: "128Mi" },
      limits: { cpu: "200m", memory: "512Mi" },
    });
    assert.equal(guaranteed(webhook), false);
    const cleanup = containersOf(
      find(docs, "Job", "leases-cleanup").spec.template.spec,
    );
    assert.equal(guaranteed(cleanup), false);
  },
  // Each render pulls the pinned chart over the network.
  120_000,
);

run(
  "flag on: the webhook and the leases-cleanup Job each request their limit, so their pods are Guaranteed",
  async () => {
    for (const name of ["local", "vps", "managed-example"]) {
      const repository = withQos(await loadRepository(name), true);
      const docs = documents(renderComponent(repository, "policy-controller"));
      const webhook = containersOf(
        find(docs, "Deployment", "policy-controller-webhook").spec.template
          .spec,
      );
      assert.ok(
        guaranteed(webhook),
        `${name} webhook: ${JSON.stringify(webhook)}`,
      );
      const cleanup = containersOf(
        find(docs, "Job", "leases-cleanup").spec.template.spec,
      );
      assert.ok(
        guaranteed(cleanup),
        `${name} cleanup: ${JSON.stringify(cleanup)}`,
      );
    }
  },
  120_000,
);
