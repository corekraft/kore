import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository } from "../config/index.js";
import { renderChart, yamlDocuments } from "./upstream-support.js";

// Renders the pinned chart through the real kore-patch post-renderer, so a
// chart bump that moves a patch target fails here, not in a live run.
test.runIf(process.env["KORE_CHECK_UPSTREAM_CHARTS"] === "1")(
  "policy-controller renders with webhook probe timeouts that survive a loaded host",
  async () => {
    const repository = await loadRepository("local");
    const component = repository.catalog.components.find(
      (c) => c.name === "policy-controller",
    )!;
    const documents = (await yamlDocuments(
      await renderChart(repository, component),
    )) as {
      kind?: string;
      metadata?: { name?: string };
      spec?: {
        template?: {
          spec?: {
            containers?: {
              name: string;
              livenessProbe?: { timeoutSeconds?: number };
              readinessProbe?: { timeoutSeconds?: number };
            }[];
          };
        };
      };
    }[];
    const webhook = documents
      .find(
        (d) =>
          d.kind === "Deployment" &&
          d.metadata?.name === "policy-controller-webhook",
      )
      ?.spec?.template?.spec?.containers?.find(
        (c) => c.name === "policy-controller-webhook",
      );
    assert.ok(webhook, "the webhook container is rendered");
    assert.ok((webhook.livenessProbe?.timeoutSeconds ?? 0) >= 5);
    assert.ok((webhook.readinessProbe?.timeoutSeconds ?? 0) >= 5);
  },
  120_000,
);
