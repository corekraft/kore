import { beforeEach, expect, test, vi } from "vitest";
import { enabledComponents } from "../config/index.js";
import { waitForGatekeeperAdmission } from "./gatekeeper-admission.js";
import {
  fakeComponent,
  fakeRepository,
  fakeRunner,
} from "./platform-support.js";
import { waitForWebhook } from "./readiness-webhook.js";

vi.mock("../config/index.js");
vi.mock("./readiness-webhook.js");

const repository = fakeRepository();
const gatekeeper = fakeComponent({ name: "gatekeeper", timeout: "7m" });

beforeEach(() => {
  vi.mocked(enabledComponents).mockReturnValue([gatekeeper]);
  vi.mocked(waitForWebhook).mockResolvedValue(undefined);
});

test("waits on Gatekeeper's validating webhook in the configured context, within the component timeout", async () => {
  const { runner } = fakeRunner();
  await waitForGatekeeperAdmission(repository, runner);
  expect(waitForWebhook).toHaveBeenCalledExactlyOnceWith(
    runner,
    "k3d-kore-local",
    "validatingwebhookconfiguration/gatekeeper-validating-webhook-configuration",
    "7m",
  );
});

test("an environment without Gatekeeper waits for nothing", async () => {
  vi.mocked(enabledComponents).mockReturnValue([
    fakeComponent({ name: "other" }),
  ]);
  await waitForGatekeeperAdmission(repository, fakeRunner().runner);
  expect(waitForWebhook).not.toHaveBeenCalled();
});

test("a webhook that never gets endpoints fails with the cause, naming Gatekeeper and the context", async () => {
  vi.mocked(waitForWebhook).mockRejectedValue(
    new Error(
      "webhook check-ignore-label.gatekeeper.sh needs Service gatekeeper-system/gatekeeper-webhook-service, which has no ready endpoints",
    ),
  );
  await expect(
    waitForGatekeeperAdmission(repository, fakeRunner().runner),
  ).rejects.toThrow(
    "Gatekeeper webhook is not ready in k3d-kore-local after 7m: webhook check-ignore-label.gatekeeper.sh needs Service gatekeeper-system/gatekeeper-webhook-service, which has no ready endpoints. Gatekeeper fails closed, so the next component's objects would be refused. Check `kubectl --context k3d-kore-local --namespace gatekeeper-system get pods` until the gatekeeper-controller-manager pods are Ready, then rerun the command.",
  );
});
