import { expect, test, vi } from "vitest";
import {
  composeChartDelivery,
  composeGoldenPathDelivery,
  composeSuborgDelivery,
  platformUp,
} from "../platform/index.js";
import { platformCommand } from "./commands-infra.js";
import { actionsOf, flags } from "./commands-infra-support.js";
import { fakeContext, fakeRepository, sharedRunner } from "./cli-support.js";

vi.mock("../platform/index.js");
vi.mock("./context.js");
vi.mock("./flags.js");
vi.mock("./output.js");

test("platform up installs from the repository composed with the chart lock, then the template lock, then the Kore URL, so every delivery is checked before the cluster is touched", async () => {
  const withCharts = fakeRepository();
  const delivered = fakeRepository();
  const withURL = fakeRepository();
  flags({
    "platform-chart-lock": "l.json",
    "platform-template-lock": "t.json",
  });
  vi.mocked(composeChartDelivery).mockResolvedValue(withCharts);
  vi.mocked(composeGoldenPathDelivery).mockResolvedValue(delivered);
  vi.mocked(composeSuborgDelivery).mockResolvedValue(withURL);
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
  expect(composeSuborgDelivery).toHaveBeenCalledWith(delivered, sharedRunner);
  expect(platformUp).toHaveBeenCalledWith(withURL, sharedRunner);
});
