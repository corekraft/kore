import { describe, expect, it } from "vitest";
import { garbled, plain, withoutDim } from "./ansi.js";

const E = "\u001b[";

describe("plain", () => {
  it("removes colour and style escapes and keeps every character", () => {
    expect(plain(`${E}0m${E}38;2;1;2;3m❯ ${E}2mhint${E}0m`)).toBe("❯ hint");
  });

  it("leaves text without escapes as it is", () => {
    expect(plain("a\nb")).toBe("a\nb");
  });
});

describe("plain strips every CSI escape, so none can hide a prompt mark", () => {
  it.each([
    ["an erase-line", `${E}2K❯ half`],
    ["a cursor move", `${E}1;1H❯ half`],
    ["a private mode switch", `${E}?25h❯ half`],
    ["a colon-style colour", `${E}38:2::1:2:3m❯ half`],
  ])("removes %s before the prompt", (_what, text) => {
    expect(plain(text)).toBe("❯ half");
  });

  it("drops the ESC of an escape that never ends and keeps the text after it", () => {
    expect(plain(`${E}38;2;1❯ half`)).toBe("[38;2;1❯ half");
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

  it("keeps typed text after an erase-line", () => {
    expect(withoutDim(`${E}2K❯ half`)).toBe("❯ half");
  });

  it("treats a faint switch combined with other parameters as faint", () => {
    expect(withoutDim(`${E}1;2mhint${E}m`)).toBe("");
  });
});

describe("garbled", () => {
  it("flags an escape that never ends", () => {
    expect(garbled(`${E}38;2;1❯ half`)).toBe(true);
  });

  it("does not flag complete escapes", () => {
    expect(garbled(`${E}2K${E}0m❯ ${E}2mhint`)).toBe(false);
  });
});
