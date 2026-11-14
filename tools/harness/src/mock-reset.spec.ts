// Mocks reset between tests by configuration (vitest `mockReset` and `restoreMocks`), so no test resets them by hand.
// Docs: infra/plans/14-test-tiers.md#step-1-foundations

import { expect, it, vi } from "vitest";

const shared = vi.fn((): string => "original");
const reader = { read: (): string => "real" };

it("sets a mock's behaviour, spies on a method and records the calls", () => {
  shared.mockReturnValue("set by the first test");
  vi.spyOn(reader, "read").mockReturnValue("spied");
  expect(shared()).toBe("set by the first test");
  expect(reader.read()).toBe("spied");
  expect(shared).toHaveBeenCalledTimes(1);
});

it("gives the next test no recorded calls, the original behaviour and the real method", () => {
  expect(shared.mock.calls).toEqual([]);
  expect(shared()).toBe("original");
  expect(reader.read()).toBe("real");
});
