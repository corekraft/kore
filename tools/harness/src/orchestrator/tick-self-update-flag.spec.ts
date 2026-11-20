import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileSystem } from "../runtime/index.js";
import { localFlagOn } from "./local-flag.js";
import {
  TICK_SELF_UPDATE_FLAG,
  tickSelfUpdateOn,
} from "./tick-self-update-flag.js";

vi.mock("./local-flag.js", () => ({ localFlagOn: vi.fn() }));

const fs = {} as FileSystem;

beforeEach(() => {
  vi.resetAllMocks();
});

describe("tickSelfUpdateOn", () => {
  it("names the tick-self-update flag", () => {
    expect(TICK_SELF_UPDATE_FLAG).toBe("tick-self-update");
  });

  it.each([true, false])(
    "is what the local overlay says about tick-self-update: %s",
    async (on) => {
      vi.mocked(localFlagOn).mockResolvedValue(on);

      expect(await tickSelfUpdateOn(fs, "/repo")).toBe(on);
      expect(localFlagOn).toHaveBeenCalledWith(fs, "/repo", "tick-self-update");
    },
  );
});
