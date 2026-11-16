import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileSystem } from "../runtime/index.js";
import { localFlagOn } from "./local-flag.js";
import { retroFlagOn } from "./retro-flag.js";

vi.mock("./local-flag.js", () => ({ localFlagOn: vi.fn() }));

const fs = {} as FileSystem;

beforeEach(() => {
  vi.resetAllMocks();
});

describe("retroFlagOn", () => {
  it.each([true, false])(
    "is what the local overlay says about automatic-retro: %s",
    async (on) => {
      vi.mocked(localFlagOn).mockResolvedValue(on);

      expect(await retroFlagOn(fs, "/repo")).toBe(on);
      expect(localFlagOn).toHaveBeenCalledWith(fs, "/repo", "automatic-retro");
    },
  );
});
