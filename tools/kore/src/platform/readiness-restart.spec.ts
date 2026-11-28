import { beforeEach, expect, test, vi } from "vitest";
import { errorMessage } from "./probe.js";
import { primeReadinessFakes, waitOn } from "./readiness-support.js";
import { foreignCertificateResources } from "./readiness-issuer.js";
import {
  controlPlaneRestartCause,
  isControlPlaneDrop,
} from "./readiness-poll.js";

vi.mock("./probe.js");
vi.mock("./readiness-custom.js");
vi.mock("./readiness-issuer.js");
vi.mock("./readiness-daemonset.js");
vi.mock("./readiness-webhook.js");
vi.mock("./readiness-poll.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./readiness-poll.js")>()),
  pollUntil: vi.fn(),
  failureAcrossBounds: vi.fn(),
  pause: vi.fn(),
  timeoutMilliseconds: vi.fn(),
  retryBudget: vi.fn(),
  isControlPlaneDrop: vi.fn(),
  controlPlaneRestartCause: vi.fn(),
}));

beforeEach(() => {
  primeReadinessFakes();
  // The foreign names are read from the records, and none of these fixtures names one.
  vi.mocked(foreignCertificateResources).mockReturnValue([]);
  vi.mocked(isControlPlaneDrop).mockReturnValue(false);
  vi.mocked(controlPlaneRestartCause).mockReturnValue("CAUSE");
});

const APISERVICE = "apiservice.apiregistration.k8s.io/v1beta1.metrics.k8s.io";

test("a control-plane drop during a wait names the restart and keeps kubectl's reason (#1309)", async () => {
  vi.mocked(isControlPlaneDrop).mockReturnValue(true);
  const dropped = () =>
    new Error(
      "error: timed out waiting for the condition\nThe connection to the server 127.0.0.1:6443 was refused",
    );
  const { wait } = waitOn([APISERVICE], dropped);

  const error = await wait().catch((caught: unknown) => caught);

  expect(controlPlaneRestartCause).toHaveBeenCalledWith("k3d-kore-local");
  expect(errorMessage(error)).toBe(
    `${APISERVICE} not ready (Available) after 0.0s (timeout 10m): CAUSE kubectl said: error: timed out waiting for the condition\nThe connection to the server 127.0.0.1:6443 was refused`,
  );
});

test("a failure that is not a control-plane drop is not renamed a restart", async () => {
  const { wait } = waitOn(
    [APISERVICE],
    () => new Error("error: timed out waiting for the condition"),
  );

  const error = await wait().catch((caught: unknown) => caught);

  expect(controlPlaneRestartCause).not.toHaveBeenCalled();
  expect(errorMessage(error)).toBe(
    `${APISERVICE} not ready (Available) after 0.0s (timeout 10m): error: timed out waiting for the condition`,
  );
});
