import { expect, test } from "vitest";
import { cpuMillis, formatCpu, formatMemory, memoryMiB } from "./quantity.js";

test("cpuMillis reads a whole-core, a decimal-core and a millicore quantity", () => {
  expect(cpuMillis("1")).toBe(1000);
  expect(cpuMillis("0.5")).toBe(500);
  expect(cpuMillis("500m")).toBe(500);
});

test("cpuMillis refuses a quantity it cannot read, so the record names the field", () => {
  expect(cpuMillis("2cores")).toBeUndefined();
  expect(cpuMillis("1e3")).toBeUndefined();
  expect(cpuMillis("")).toBeUndefined();
});

test("memoryMiB reads Ki, Mi, Gi and Ti in mebibytes", () => {
  expect(memoryMiB("512Mi")).toBe(512);
  expect(memoryMiB("1Gi")).toBe(1024);
  expect(memoryMiB("1Ti")).toBe(1024 * 1024);
  expect(memoryMiB("1024Ki")).toBe(1);
});

test("memoryMiB refuses a bare byte count or a unit it does not know", () => {
  expect(memoryMiB("512M")).toBeUndefined();
  expect(memoryMiB("512")).toBeUndefined();
  expect(memoryMiB("1GB")).toBeUndefined();
  expect(memoryMiB("1.5Gi")).toBeUndefined();
});

test("formatCpu and formatMemory name a quantity in the form a record writes", () => {
  expect(formatCpu(1500)).toBe("1500m");
  expect(formatCpu(2000)).toBe("2");
  expect(formatMemory(512)).toBe("512Mi");
  expect(formatMemory(2048)).toBe("2Gi");
});
