import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileSystem } from "../runtime/index.js";
import { localFlagOn } from "./local-flag.js";
import { BRANCH_NOTICE_FLAG, branchNoticeFlagOn } from "./tick-branch-flag.js";

vi.mock("./local-flag.js", () => ({ localFlagOn: vi.fn() }));

const fs = {} as FileSystem;

beforeEach(() => {
  vi.resetAllMocks();
});

describe("branchNoticeFlagOn", () => {
  it("names the behind-main-notice flag", () => {
    expect(BRANCH_NOTICE_FLAG).toBe("behind-main-notice");
  });

  it.each([true, false])(
    "is what the local overlay says about behind-main-notice: %s",
    async (on) => {
      vi.mocked(localFlagOn).mockResolvedValue(on);

      expect(await branchNoticeFlagOn(fs, "/repo")).toBe(on);
      expect(localFlagOn).toHaveBeenCalledWith(
        fs,
        "/repo",
        "behind-main-notice",
      );
    },
  );
});
