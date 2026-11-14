import { describe, expect, it } from "vitest";
import {
  parseFreeSwap,
  parseMemoryPressure,
  parseSwapUsage,
} from "./host-sample-parse.js";

describe("parseMemoryPressure", () => {
  it("reads the free percentage as a share of total", () => {
    expect(
      parseMemoryPressure(
        "The system has 17179869184 (4194304 pages)\nSystem-wide memory free percentage: 63%\n",
      ),
    ).toBe(0.63);
  });

  it("reads a report without the percentage as absent", () => {
    expect(parseMemoryPressure("nothing useful")).toBeUndefined();
  });
});

describe("parseSwapUsage", () => {
  it("reads the used swap from sysctl in bytes", () => {
    expect(
      parseSwapUsage(
        "total = 6144.00M  used = 4871.50M  free = 1272.50M  (encrypted)\n",
      ),
    ).toBe(5108137984);
  });

  it("reads gigabyte units", () => {
    expect(parseSwapUsage("total = 2.00G  used = 1.00G  free = 1.00G")).toBe(
      1073741824,
    );
  });

  it("reads output without a used figure as absent", () => {
    expect(parseSwapUsage("vm.swapusage: unknown")).toBeUndefined();
  });
});

describe("parseFreeSwap", () => {
  it("reads the used column of the Swap row", () => {
    expect(
      parseFreeSwap(
        "              total        used        free\nMem:    16000000000  9000000000  1000000000\nSwap:    2000000000   123456789  1876543211\n",
      ),
    ).toBe(123456789);
  });

  it("reads output without a Swap row as absent", () => {
    expect(parseFreeSwap("Mem: 1 2 3\n")).toBeUndefined();
  });
});
