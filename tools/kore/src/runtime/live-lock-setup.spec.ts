import { expect, it, vi } from "vitest";
import { holdLiveLock } from "./live-lock.js";

vi.mock("./live-lock.js");

it("takes the live lock once, with its defaults, when the setup module loads", async () => {
  vi.mocked(holdLiveLock).mockResolvedValue(undefined);

  await import("./live-lock-setup.js");

  expect(holdLiveLock).toHaveBeenCalledTimes(1);
  expect(holdLiveLock).toHaveBeenCalledWith();
});
