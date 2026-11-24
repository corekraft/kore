import { beforeEach, expect, test, vi } from "vitest";
import { withFailFast } from "./fail-fast.js";
import { desiredFingerprint } from "./fingerprint.js";
import {
  assertChartDelivery,
  assertGoldenPathDelivery,
  envOption,
  helmEnv,
  helmUpgradeArgs,
  releaseGatewayClassChange,
  withAbsoluteChart,
} from "./helm.js";
import {
  fakeComponent,
  fakeRepository,
  fakeRunner,
} from "./platform-support.js";
import { errorMessage } from "./probe.js";
import { reconcileComponent } from "./reconcile.js";
import { waitFor } from "./readiness.js";

vi.mock("./fail-fast.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./fail-fast.js")>()),
  withFailFast: vi.fn(),
}));
vi.mock("./fingerprint.js");
vi.mock("./helm.js");
vi.mock("./probe.js");
vi.mock("./readiness.js");
vi.mock("./release-recovery.js");

const repository = fakeRepository();
const chart = fakeComponent({ name: "kore-platform-config" });

beforeEach(() => {
  vi.mocked(withFailFast).mockImplementation((_repo, runner, _c, run) =>
    run(runner),
  );
  vi.mocked(desiredFingerprint).mockReturnValue("fp-desired");
  vi.mocked(helmUpgradeArgs).mockReturnValue(["upgrade"]);
  vi.mocked(helmEnv).mockReturnValue(undefined);
  vi.mocked(envOption).mockReturnValue({});
  vi.mocked(withAbsoluteChart).mockImplementation((_repo, _c, args) => args);
  vi.mocked(assertChartDelivery).mockReturnValue();
  vi.mocked(assertGoldenPathDelivery).mockReturnValue();
  vi.mocked(errorMessage).mockImplementation((error) =>
    error instanceof Error ? error.message : String(error),
  );
  vi.mocked(waitFor).mockResolvedValue();
});

test("a class change is released immediately before the Helm upgrade, so Helm recreates the Gateway", async () => {
  const order: string[] = [];
  vi.mocked(releaseGatewayClassChange).mockImplementation(async () => {
    order.push("release");
  });
  const { runner, run } = fakeRunner();
  run.mockImplementation(async (command) => {
    order.push(command);
    return { stdout: "", stderr: "", code: 0 };
  });
  await reconcileComponent(repository, runner, chart);
  expect(order).toEqual(["release", "helm"]);
  expect(releaseGatewayClassChange).toHaveBeenCalledWith(
    repository,
    runner,
    chart,
  );
});

test("a chart refused before Helm runs never touches the Gateway", async () => {
  vi.mocked(assertChartDelivery).mockImplementation(() => {
    throw new Error("needs the chart lock");
  });
  await expect(
    reconcileComponent(repository, fakeRunner().runner, chart),
  ).rejects.toThrow("needs the chart lock");
  expect(releaseGatewayClassChange).not.toHaveBeenCalled();
});
