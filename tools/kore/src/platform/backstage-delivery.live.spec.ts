import assert from "node:assert/strict";
import test from "node:test";
import { checkBackstageDelivery } from "../testing/index.js";
import { live, setup } from "./identity-live.js";

// Docs: docs/decisions/0180-backstage-reads-the-argo-cd-view-as-its-own-service-account-gated-by-the-operators-policy.md
// Docs: infra/plans/15-next-horizon.md (Step 6, the delivered services in Backstage)
// Live and opt-in; see identity-live.ts. Run: npm run test:live:backstage-delivery
// (in tools/kore), with KORE_RUN_LIVE=1 and KORE_BACKSTAGE_SERVICE=<service>, the
// delivered Service's name, one DNS label, such as golden-path-example.
// The preconditions: the platform-portal flag on and converged, and the Service
// delivered (its Argo CD Application Synced). It creates a throwaway operators-group
// user and removes it, on success and on failure. The output is one JSON line with
// four assertions: statuses, names, the Application's sync and health and the
// workload's replica counts. It holds no token, cookie or page text.

const service = process.env.KORE_BACKSTAGE_SERVICE;

test(
  "a signed-in operator sees a delivered Service in Backstage with its Argo CD Application and its workload's rollout",
  live,
  async () => {
    if (service === undefined || service === "") {
      throw new Error(
        "set KORE_BACKSTAGE_SERVICE to the delivered Service's name, such as golden-path-example",
      );
    }
    const { repository, runner } = await setup();
    const result = await checkBackstageDelivery(repository, runner, service);
    console.log(JSON.stringify(result));
    assert.deepEqual(
      result.assertions.map((assertion) => assertion.name),
      [
        "backstage identity carries the operators group",
        "catalog lists the delivered service",
        "kubernetes read returns the service's Argo CD Application with its sync and health",
        "kubernetes read returns the service's workload with its rollout",
      ],
    );
    for (const assertion of result.assertions) {
      assert.equal(assertion.ok, true, assertion.name);
    }
  },
);
