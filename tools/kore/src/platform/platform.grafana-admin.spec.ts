import { expect, test, vi } from "vitest";

const order: string[] = [];
vi.mock("./grafana-admin.js", () => ({
  reconcileGrafanaAdminPassword: async () => {
    order.push("grafana-admin-password");
  },
}));
vi.mock("./admission-gate.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./admission-gate.js")>()),
  closeExistingAdmissionGate: async () => undefined,
}));
vi.mock("./reconcile.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./reconcile.js")>()),
  reconcileIfNeeded: async (
    _repository: unknown,
    _runner: unknown,
    component: { name: string },
  ) => {
    order.push(`reconcile:${component.name}`);
  },
}));
import { loadRepository } from "../config/index.js";
import { RecordingRunner } from "../runtime/runner.js";
import { bootstrapControllers } from "./bootstrap.js";
import { withHealthyWebhooks } from "./webhook-fixtures.js";

test("bootstrap resets the Grafana admin password right after Grafana is ready, before anything that depends on it", async () => {
  const repository = await loadRepository("local");
  const runner = new RecordingRunner([
    { stdout: '{"Host":"Running"}', stderr: "", code: 0 },
    { stdout: "kube-system", stderr: "", code: 0 },
  ]);

  await bootstrapControllers(repository, withHealthyWebhooks(runner));

  const grafana = order.indexOf("reconcile:grafana");
  expect(grafana).toBeGreaterThanOrEqual(0);
  expect(order[grafana + 1]).toBe("grafana-admin-password");
  expect(order.filter((o) => o === "grafana-admin-password")).toHaveLength(1);
});
