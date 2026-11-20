import { beforeEach, describe, expect, it, vi } from "vitest";
import { environments, readOverlay } from "../flag/index.js";
import type { FileSystem } from "../runtime/index.js";
import { TICKET_QUEUE_FLAG, ticketQueueOn } from "./flag.js";

vi.mock("../flag/index.js", () => ({
  environments: vi.fn(),
  readOverlay: vi.fn(),
}));

const fs = {} as FileSystem;

beforeEach(() => {
  vi.resetAllMocks();
});

describe("ticketQueueOn", () => {
  it("names the tick-ticket-queue flag", () => {
    expect(TICKET_QUEUE_FLAG).toBe("tick-ticket-queue");
  });

  it("is off when there is no local overlay, and reads no overlay", async () => {
    vi.mocked(environments).mockResolvedValue(["vps"]);

    expect(await ticketQueueOn(fs, "/repo")).toBe(false);
    expect(readOverlay).not.toHaveBeenCalled();
  });

  it.each([
    [true, true],
    [false, false],
  ])(
    "is what the local overlay says about tick-ticket-queue when it sets it to %s",
    async (set, expected) => {
      vi.mocked(environments).mockResolvedValue(["local"]);
      vi.mocked(readOverlay).mockResolvedValue({
        name: "local",
        features: { [TICKET_QUEUE_FLAG]: set },
      } as never);

      expect(await ticketQueueOn(fs, "/repo")).toBe(expected);
      expect(readOverlay).toHaveBeenCalledWith(fs, "/repo", "local");
    },
  );

  it("is off when the local overlay does not name the flag at all", async () => {
    vi.mocked(environments).mockResolvedValue(["local"]);
    vi.mocked(readOverlay).mockResolvedValue({
      name: "local",
      features: {},
    } as never);

    expect(await ticketQueueOn(fs, "/repo")).toBe(false);
  });
});
