import { describe, expect, it, vi } from "vitest";
import { chromiumProgram } from "./chromium-program.js";
import * as browser from "./index.js";
import { pinnedBrowserImage, runHeadlessBrowser } from "./headless-browser.js";

vi.mock("./chromium-program.js", () => ({
  chromiumProgram: vi.fn(() => "program"),
}));
vi.mock("./headless-browser.js", () => ({
  pinnedBrowserImage: "mcr.microsoft.com/playwright:pinned",
  runHeadlessBrowser: vi.fn(),
}));

describe("the browser barrel", () => {
  it("exposes the driver, its pinned image and the program builder, and nothing else", () => {
    expect(Object.keys(browser).sort()).toEqual([
      "chromiumProgram",
      "pinnedBrowserImage",
      "runHeadlessBrowser",
    ]);
  });

  it("re-exports the module functions rather than wrapping them", () => {
    expect(browser.chromiumProgram).toBe(chromiumProgram);
    expect(browser.runHeadlessBrowser).toBe(runHeadlessBrowser);
    expect(browser.pinnedBrowserImage).toBe(pinnedBrowserImage);
  });
});
