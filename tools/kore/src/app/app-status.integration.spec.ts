import assert from "node:assert/strict";
import test from "node:test";
import { findRoot } from "../config/config.js";
import { loadRepository } from "../config/index.js";
import { ProcessRunner } from "../runtime/index.js";
import { appStatus } from "./index.js";

// Docs: infra/plans/2-implementation.md#step-13-complete-lifecycle-orchestration
// Live and opt-in (`npm run test:integration:app-status`): on a running local
// profile with the `reference` application up, proves `kore app status`
// reports what is really deployed. The reported digest is compared with the
// image digest the running pods carry, and the report must not hold a
// credential. Read-only: it reads one status and pod metadata, no Secret.

const name = "reference";

test(
  "app status reports the deployed digest, signer, registry and enforcement the cluster actually has",
  {
    concurrency: false,
    timeout: 5 * 60 * 1000,
    skip:
      process.env.KORE_RUN_INTEGRATION !== "1"
        ? "set KORE_RUN_INTEGRATION=1 to opt into a live local profile"
        : false,
  },
  async () => {
    const repository = await loadRepository("local", await findRoot());
    const runner = new ProcessRunner();
    const status = await appStatus(repository, runner, name);
    const deployed = status["deployed"] as {
      digest: string;
      registry: string;
      matchesLock: boolean;
      signer: string;
      namespaceImageEnforcement: string;
    };

    assert.equal(status["status"], "ready");
    assert.match(deployed.digest, /^sha256:[0-9a-f]{64}$/);
    assert.equal(
      deployed.matchesLock,
      true,
      "the release carries the locked digest",
    );
    assert.notEqual(deployed.signer, "");
    assert.notEqual(deployed.registry, "");
    assert.equal(deployed.namespaceImageEnforcement, "enrolled");

    // The digest is what the pods run, not only what Helm was told.
    const running = (
      await runner.run(
        "kubectl",
        [
          "--context",
          repository.environment.kubeContext,
          "--namespace",
          name,
          "get",
          "pods",
          "--selector=app.kubernetes.io/part-of=reference",
          '--output=jsonpath={range .items[*].status.containerStatuses[*]}{.imageID}{"\\n"}{end}',
        ],
        { capture: true },
      )
    ).stdout;
    assert.ok(
      running.includes(deployed.digest),
      `a running container carries ${deployed.digest}; pods report ${running.trim()}`,
    );

    assert.doesNotMatch(
      JSON.stringify(status),
      /password|authorization|bearer |BEGIN [A-Z ]*PRIVATE KEY/i,
      "the status report exposes no credential",
    );
  },
);
