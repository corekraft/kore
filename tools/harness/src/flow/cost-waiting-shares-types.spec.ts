import { describe, expect, it } from "vitest";
import {
  RATE_DAYS,
  RATE_LABEL,
  SIZE_LABEL,
} from "./cost-waiting-shares-types.js";

describe("ceiling share types: the two meanings and their labels", () => {
  it("labels a per-agent rate and a size differently, so a table cannot mix them", () => {
    expect(RATE_LABEL).toBe("of the weekly ceiling");
    expect(SIZE_LABEL).toBe("of one week's ceiling");
    expect(RATE_LABEL).not.toBe(SIZE_LABEL);
  });

  it("reads a rate over a week", () => {
    expect(RATE_DAYS).toBe(7);
  });
});
