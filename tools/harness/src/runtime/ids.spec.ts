import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { systemIds } from "./ids.js";

vi.mock("node:crypto");

type Uuid = ReturnType<typeof randomUUID>;

describe("systemIds.next", () => {
  it("returns a fresh random UUID from node's crypto on each call", () => {
    vi.mocked(randomUUID)
      .mockReturnValueOnce("first-id" as Uuid)
      .mockReturnValueOnce("second-id" as Uuid);
    expect(systemIds.next()).toBe("first-id");
    expect(systemIds.next()).toBe("second-id");
    expect(vi.mocked(randomUUID)).toHaveBeenCalledTimes(2);
  });
});
