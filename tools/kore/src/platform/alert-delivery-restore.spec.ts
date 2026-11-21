// Docs: docs/decisions/0128-forward-fired-service-alerts-from-the-metrics-store-to-grafana-s-alert-manager.md
import { expect, test, vi } from "vitest";
import { prove, proveFailing, proofEvents } from "./alert-delivery-support.js";

// The poll is a stand-in that reads at most three times and gives up, so no test waits on a real timer.
vi.mock("./alert-delivery-poll.live.js", () => ({
  awaitValue: async (read: () => Promise<unknown>) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const value = await read();
      if (value !== undefined) {
        return value;
      }
    }
    return undefined;
  },
}));

test("restores from the record a killed run left, before it checks the rule, and clears the record", async () => {
  const { report, events } = await prove({
    rules: ["absent"],
    deployments: { "golden-path-example": { replicas: 0, recorded: 2 } },
  });
  expect(report.stage).toBe("rule not loaded");
  expect(report.calls).toEqual([
    "kubectl get deployments",
    "kubectl scale deployment",
    "kubectl annotate deployment",
    "Prometheus GET /api/v1/rules",
  ]);
  expect(events).toEqual([
    "scale golden-path-example--local/golden-path-example=2",
    "forget golden-path-example--local/golden-path-example",
  ]);
});

test("after restoring a killed run's Deployments, proves the alert again on them", async () => {
  const { report, events } = await prove({
    deployments: { "golden-path-example": { replicas: 0, recorded: 2 } },
  });
  expect(report.status).toBe("delivered");
  expect(events).toEqual([
    "scale golden-path-example--local/golden-path-example=2",
    "forget golden-path-example--local/golden-path-example",
    ...proofEvents,
  ]);
});

test("does not fire while a killed run's Deployments are still at zero and cannot be restored", async () => {
  const { message, events } = await proveFailing({
    deployments: { "golden-path-example": { replicas: 0, recorded: 2 } },
    refuseRestore: true,
  });
  expect(message).toBe(
    "could not restore these Deployments in golden-path-example--local; scale them back by hand: golden-path-example to 2 replicas (kubectl refused)",
  );
  expect(events).toEqual([
    "scale golden-path-example--local/golden-path-example=2",
  ]);
});

test("tries every Deployment when a restore is refused, names them all, and keeps each record for the next run", async () => {
  const { message, events } = await proveFailing({
    deployments: {
      "golden-path-example": { replicas: 2 },
      "kore-worker": { replicas: 1 },
    },
    refuseRestore: true,
  });
  expect(message).toBe(
    "could not restore these Deployments in golden-path-example--local; scale them back by hand: golden-path-example to 2 replicas (kubectl refused); kore-worker to 1 replicas (kubectl refused)",
  );
  expect(events).toEqual([
    "annotate golden-path-example--local/golden-path-example=2",
    "scale golden-path-example--local/golden-path-example=0",
    "annotate golden-path-example--local/kore-worker=1",
    "scale golden-path-example--local/kore-worker=0",
    "scale golden-path-example--local/golden-path-example=2",
    "scale golden-path-example--local/kore-worker=1",
  ]);
});

test("rethrows the stage error unchanged when the restore succeeds", async () => {
  const { message, events } = await proveFailing({
    receiversError: "Grafana alerts answer is not JSON",
  });
  expect(message).toBe("Grafana alerts answer is not JSON");
  expect(events).toEqual(proofEvents);
});

test("keeps the failed stage and its detail in the message when a stage fails and the restore is refused too", async () => {
  const { message } = await proveFailing({
    receivers: [undefined],
    refuseRestore: true,
  });
  expect(message).toBe(
    "could not restore these Deployments in golden-path-example--local; scale them back by hand: golden-path-example to 2 replicas (kubectl refused); the proof ended at stage alert not forwarded: Grafana shows no ServiceUnavailable alert for golden-path-example within 900 s; the metrics store did not forward it",
  );
});

test("keeps the stage error in the message when the restore is refused too", async () => {
  const { message } = await proveFailing({
    receiversError: "Grafana alerts answer is not JSON",
    refuseRestore: true,
  });
  expect(message).toBe(
    "could not restore these Deployments in golden-path-example--local; scale them back by hand: golden-path-example to 2 replicas (kubectl refused); the proof stopped first with: Grafana alerts answer is not JSON",
  );
});
