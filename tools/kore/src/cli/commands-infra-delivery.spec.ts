import { expect, test, vi } from "vitest";
import {
  composeChartDelivery,
  composeGoldenPathDelivery,
  platformUp,
} from "../platform/index.js";
import { platformCommand } from "./commands-infra.js";
import { actionsOf, flags } from "./commands-infra-support.js";
import { fakeContext, fakeRepository, sharedRunner } from "./cli-support.js";

vi.mock("../platform/index.js");
vi.mock("./context.js");
vi.mock("./flags.js");
vi.mock("./output.js");

test("platform up installs from the repository composed with the chart lock, then the template lock, so both deliveries are checked before the cluster is touched", async () => {
  const withCharts = fakeRepository();
  const delivered = fakeRepository();
  flags({
    "platform-chart-lock": "l.json",
    "platform-template-lock": "t.json",
  });
  vi.mocked(composeChartDelivery).mockResolvedValue(withCharts);
  vi.mocked(composeGoldenPathDelivery).mockResolvedValue(delivered);
  const context = fakeContext({ command: "platform", action: "up" });
  await platformCommand(context);
  await actionsOf().up!(context, sharedRunner);
  expect(composeChartDelivery).toHaveBeenCalledWith(
    context.repository,
    "l.json",
  );
  expect(composeGoldenPathDelivery).toHaveBeenCalledWith(
    withCharts,
    sharedRunner,
    "t.json",
  );
  expect(platformUp).toHaveBeenCalledWith(delivered, sharedRunner);
});
