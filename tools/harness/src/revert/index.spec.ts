import { describe, expect, it } from "vitest";
import * as barrel from "./index.js";

describe("the revert barrel", () => {
  it("exposes the flag, the git steps and the decision unit", () => {
    expect(Object.keys(barrel).sort()).toEqual([
      "GitRevert",
      "PrepareRevert",
      "REVERT_BODY_SAFETY",
      "REVERT_FLAG",
      "revertFlagOn",
    ]);
  });
});
