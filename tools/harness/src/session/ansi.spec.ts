import { describe, expect, it } from "vitest";
import { plain, withoutDim } from "./ansi.js";

const E = "\u001b[";

describe("plain", () => {
  it("removes colour and style escapes and keeps every character", () => {
    expect(plain(`${E}0m${E}38;2;1;2;3m❯ ${E}2mhint${E}0m`)).toBe("❯ hint");
  });

  it("leaves text without escapes as it is", () => {
    expect(plain("a\nb")).toBe("a\nb");
  });
});

describe("withoutDim", () => {
  it("drops the faint placeholder after the prompt mark", () => {
    expect(withoutDim(`${E}0m❯ ${E}2mretry the notify${E}0m`)).toBe("❯ ");
  });

  it("keeps text typed in normal style", () => {
    expect(withoutDim(`${E}0m❯ ${E}0mhalf typed${E}0m`)).toBe("❯ half typed");
  });

  it("keeps typed text that follows a placeholder once faint is switched off", () => {
    expect(withoutDim(`${E}2mhint${E}22mreal`)).toBe("real");
  });

  it("does not take the 2 inside a true-colour sequence for faint", () => {
    expect(withoutDim(`${E}38;2;170;178;240mtyped${E}0m`)).toBe("typed");
  });

  it("treats a faint switch combined with other parameters as faint", () => {
    expect(withoutDim(`${E}1;2mhint${E}m`)).toBe("");
  });
});
