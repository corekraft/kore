import assert from "node:assert/strict";
import test from "node:test";
import { loadRepository } from "../config/index.js";
import { ProcessRunner, liveEnvironment } from "../runtime/index.js";
import { DeliveryStageTimer } from "./delivery-stage-timer.js";

// Docs: infra/plans/15-next-horizon.md (Step 7) and tracking issue #616
// Live: needs a converged local k3d platform and one merged Service change whose
// digest is signed. Read-only: `kubectl get` only; it changes no resource. Prints
// the report as JSON, cold and redeploy kept apart. Record the host load beside
// the result. Run with KORE_RUN_LIVE=1 KORE_DELIVERY_SERVICE=<name>
// KORE_DELIVERY_MERGED_AT=<RFC 3339 merge time> KORE_DELIVERY_HOST=<https host>
// (`npm run test:live:delivery-stage`).

const live = {
  concurrency: false,
  skip:
    process.env.KORE_RUN_LIVE !== "1"
      ? "set KORE_RUN_LIVE=1 to opt into a live platform"
      : false,
  timeout: 5 * 60 * 1000,
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      `${name} is required for the delivery-stage timer; set it to the value described in tools/kore/src/platform/delivery-stage-timer.live.spec.ts`,
    );
  }
  return value;
}

test(
  "times one merged Service change through its six delivery stages without changing the cluster",
  live,
  async () => {
    const repository = await loadRepository(liveEnvironment());
    const timer = new DeliveryStageTimer(
      new ProcessRunner(),
      {
        service: requiredEnv("KORE_DELIVERY_SERVICE"),
        environment: repository.environment.name,
        kubeContext: repository.environment.kubeContext,
        host: requiredEnv("KORE_DELIVERY_HOST"),
        mergedAt: requiredEnv("KORE_DELIVERY_MERGED_AT"),
      },
      { now: () => Date.now() },
    );
    const report = await timer.measure();
    const runs = [...report.cold, ...report.redeploy];
    assert.equal(runs.length, 1);
    console.log(JSON.stringify(report, null, 2));
  },
);
