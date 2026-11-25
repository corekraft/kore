import { expect, test, vi } from "vitest";
import {
  composeChartDelivery,
  composeGoldenPathDelivery,
  platformPreflight,
  platformUp,
} from "../platform/index.js";
import { platformCommand } from "./commands-infra.js";
import { actionsOf, flags } from "./commands-infra-support.js";
import { fakeContext, fakeRepository, sharedRunner } from "./cli-support.js";

vi.mock("../platform/index.js");
vi.mock("./context.js");
vi.mock("./flags.js");
vi.mock("./output.js");

const repository = fakeRepository();

test("platform up preflights the run with both locks it was given, before composing them or applying anything", async () => {
  flags({
    "platform-chart-lock": "c.json",
    "platform-template-lock": "t.json",
  });
  vi.mocked(composeChartDelivery).mockResolvedValue(repository);
  vi.mocked(composeGoldenPathDelivery).mockResolvedValue(repository);
  const context = fakeContext({ command: "platform", action: "up" });
  await platformCommand(context);
  await actionsOf().up!(context, sharedRunner);
  expect(platformPreflight).toHaveBeenCalledWith(repository, sharedRunner, {
    chartLock: "c.json",
    templateLock: "t.json",
  });
  const [preflight] = vi.mocked(platformPreflight).mock.invocationCallOrder;
  expect(preflight).toBeLessThan(
    vi.mocked(composeChartDelivery).mock.invocationCallOrder[0] ?? Infinity,
  );
  expect(preflight).toBeLessThan(
    vi.mocked(platformUp).mock.invocationCallOrder[0] ?? Infinity,
  );
});

test("a refused preflight stops platform up before any lock is composed, so the refusal reaches the operator and nothing is applied", async () => {
  vi.mocked(platformPreflight).mockRejectedValueOnce(
    new Error("kore platform up --environment vps stopped before any change"),
  );
  const context = fakeContext({ command: "platform", action: "up" });
  await platformCommand(context);
  await expect(actionsOf().up!(context, sharedRunner)).rejects.toThrow(
    "stopped before any change",
  );
  expect(composeChartDelivery).not.toHaveBeenCalled();
  expect(platformUp).not.toHaveBeenCalled();
});
