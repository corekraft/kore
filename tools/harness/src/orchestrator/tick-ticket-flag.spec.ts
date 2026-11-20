import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileSystem } from "../runtime/index.js";
import { localFlagOn } from "./local-flag.js";
import { TICKET_FLAG, ticketFlagOn } from "./tick-ticket-flag.js";

vi.mock("./local-flag.js", () => ({ localFlagOn: vi.fn() }));

const fs = {} as FileSystem;

beforeEach(() => {
  vi.resetAllMocks();
});

describe("ticketFlagOn", () => {
  it("names the tick-ticket-queue flag", () => {
    expect(TICKET_FLAG).toBe("tick-ticket-queue");
  });

  it.each([true, false])(
    "is what the local overlay says about tick-ticket-queue: %s",
    async (on) => {
      vi.mocked(localFlagOn).mockResolvedValue(on);

      expect(await ticketFlagOn(fs, "/repo")).toBe(on);
      expect(localFlagOn).toHaveBeenCalledWith(
        fs,
        "/repo",
        "tick-ticket-queue",
      );
    },
  );
});
