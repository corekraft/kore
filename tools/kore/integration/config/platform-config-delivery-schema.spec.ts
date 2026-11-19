import assert from "node:assert/strict";
import { test } from "vitest";
import {
  renderDelivery,
  withFlags,
} from "./platform-config-delivery-project-support.js";

// Docs: docs/decisions/0043-platform-configuration-through-argo-cd.md (the handover values)

test("the delivery chart schema accepts a release for every argocd-owned catalog component when every flag is on", async () => {
  const { handedOver, applications } = await renderDelivery(
    await withFlags(true),
  );
  for (const gated of [
    "kore-policy-sync",
    "kore-hostname-ownership-templates",
    "kore-hostname-ownership",
  ]) {
    assert.ok(handedOver.includes(gated), `${gated} is handed to Argo CD`);
  }
  assert.deepEqual([...applications].sort(), [...handedOver].sort());
}, 60_000);

test("the delivery chart schema accepts the handover and creates no Application for a gated component when every flag is off", async () => {
  const { handedOver, applications } = await renderDelivery(
    await withFlags(false),
  );
  assert.equal(handedOver.includes("kore-hostname-ownership"), false);
  assert.deepEqual([...applications].sort(), [...handedOver].sort());
  assert.equal(
    applications.some((name) => name.startsWith("kore-hostname-ownership")),
    false,
  );
}, 60_000);
