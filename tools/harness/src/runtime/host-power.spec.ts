import { beforeEach, expect, it, vi } from "vitest";
import { readPower } from "./host-power.js";
import type { Runner } from "./runner.js";

const run = vi.fn<Runner["run"]>();
const runner: Runner = { run };
const reply = (code: number, stdout = "") => ({ code, stdout, stderr: "" });

const ON_AC =
  "Now drawing from 'AC Power'\n -InternalBattery-0 100%; charged\n";
const ON_BATTERY =
  "Now drawing from 'Battery Power'\n -InternalBattery-0 61%; discharging\n";

beforeEach(() => {
  vi.resetAllMocks();
});

it("reads AC power from the first line pmset prints when the Mac draws from the mains", async () => {
  run.mockResolvedValue(reply(0, ON_AC));

  expect(await readPower(runner, "darwin")).toBe("ac");
  expect(run).toHaveBeenCalledWith("pmset", ["-g", "batt"]);
});

it("reads battery power when the Mac draws from its battery", async () => {
  run.mockResolvedValue(reply(0, ON_BATTERY));

  expect(await readPower(runner, "darwin")).toBe("battery");
});

it("reads an unrecognised pmset report as unknown, never as AC power", async () => {
  run.mockResolvedValue(reply(0, "Something new entirely\n"));

  expect(await readPower(runner, "darwin")).toBe("unknown");
});

it("reads a pmset that exits non-zero as unknown", async () => {
  run.mockResolvedValue(reply(1, ON_AC));

  expect(await readPower(runner, "darwin")).toBe("unknown");
});

it("reads a pmset that cannot be run as unknown instead of failing the pass", async () => {
  run.mockRejectedValue(new Error("spawn pmset ENOENT"));

  expect(await readPower(runner, "darwin")).toBe("unknown");
});

it("reads a host with no pmset as unknown, and never runs pmset off macOS", async () => {
  expect(await readPower(runner, "linux")).toBe("unknown");
  expect(run).not.toHaveBeenCalled();
});
