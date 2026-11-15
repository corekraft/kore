import { beforeEach, expect, test, vi } from "vitest";
import { LoadPacer } from "./ingress-pacer.js";
import { pacingPlan } from "./ingress-pacing.js";

vi.mock("./ingress-pacing.js", () => ({ pacingPlan: vi.fn() }));

const deps = {
  sleep: vi.fn<(seconds: number) => Promise<void>>(async () => undefined),
  now: vi.fn(() => 0),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(pacingPlan).mockReturnValue({ batchSize: 10, batchSeconds: 0.25 });
});

test("without a target the batch is the requests per route and the clock is never read", async () => {
  const pacer = new LoadPacer(undefined, 200, deps);

  const began = pacer.begin();
  await pacer.end(began);

  expect(pacer.batchSize).toBe(200);
  expect(pacer.target).toBeUndefined();
  expect(pacingPlan).not.toHaveBeenCalled();
  expect(deps.now).not.toHaveBeenCalled();
  expect(deps.sleep).not.toHaveBeenCalled();
});

test("with a target the batch size comes from the pacing plan", () => {
  const pacer = new LoadPacer(40, 200, deps);

  expect(pacingPlan).toHaveBeenCalledWith(40, 200);
  expect(pacer.batchSize).toBe(10);
  expect(pacer.target).toBe(40);
});

test("a batch that finishes early sleeps out the rest of its slot", async () => {
  const pacer = new LoadPacer(40, 200, deps);
  vi.mocked(deps.now).mockReturnValueOnce(1000).mockReturnValueOnce(1100);

  await pacer.end(pacer.begin());

  expect(deps.sleep).toHaveBeenCalledExactlyOnceWith(0.15);
});

test("a batch slower than its slot is followed by no sleep", async () => {
  const pacer = new LoadPacer(40, 200, deps);
  vi.mocked(deps.now).mockReturnValueOnce(1000).mockReturnValueOnce(1400);

  await pacer.end(pacer.begin());

  expect(deps.sleep).not.toHaveBeenCalled();
});
