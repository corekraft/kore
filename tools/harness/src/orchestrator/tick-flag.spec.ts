import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileSystem } from "../runtime/index.js";
import { localFlagOn } from "./local-flag.js";
import { TICK_FLAG, tickFlagOn } from "./tick-flag.js";

vi.mock("./local-flag.js", () => ({ localFlagOn: vi.fn() }));

const fs = {} as FileSystem;

beforeEach(() => {
  vi.resetAllMocks();
});

describe("tickFlagOn", () => {
  it("names the orchestrator-tick flag", () => {
    expect(TICK_FLAG).toBe("orchestrator-tick");
  });

  it.each([true, false])(
    "is what the local overlay says about orchestrator-tick: %s",
    async (on) => {
      vi.mocked(localFlagOn).mockResolvedValue(on);

      expect(await tickFlagOn(fs, "/repo")).toBe(on);
      expect(localFlagOn).toHaveBeenCalledWith(
        fs,
        "/repo",
        "orchestrator-tick",
      );
    },
  );
});
