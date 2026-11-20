import { beforeEach, expect, it, vi } from "vitest";
import { readPower } from "./host-power.js";
import type { FileSystem } from "./filesystem.js";
import type { Runner } from "./runner.js";

const run = vi.fn<Runner["run"]>();
const runner: Runner = { run };
const readdir = vi.fn<FileSystem["readdir"]>();
const readFile = vi.fn<FileSystem["readFile"]>();
const fs: Pick<FileSystem, "readdir" | "readFile"> = { readdir, readFile };
const SUPPLIES = "/sys/class/power_supply";
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

it("never runs pmset off macOS", async () => {
  readdir.mockResolvedValue([]);

  await readPower(runner, "linux", fs);

  expect(run).not.toHaveBeenCalled();
});

/** Answers each supply file from a map keyed `<supply>/<file>`; any other file is unreadable. */
function supplies(files: Record<string, string>) {
  const names = [...new Set(Object.keys(files).map((k) => k.split("/")[0]!))];
  readdir.mockResolvedValue(names);
  readFile.mockImplementation(async (path) => {
    const value = files[path.slice(SUPPLIES.length + 1)];
    if (value === undefined) {
      throw new Error(`ENOENT ${path}`);
    }
    return value;
  });
}

it("reads a Linux host with no battery as AC power, so a server is not held by saver", async () => {
  supplies({ "AC/type": "Mains\n" });

  expect(await readPower(runner, "linux", fs)).toBe("ac");
  expect(readdir).toHaveBeenCalledWith(SUPPLIES);
});

it("reads a Linux host with no power supplies at all as AC power", async () => {
  readdir.mockResolvedValue([]);

  expect(await readPower(runner, "linux", fs)).toBe("ac");
});

it("reads a Linux laptop whose battery is discharging as battery", async () => {
  supplies({
    "AC/type": "Mains\n",
    "BAT0/type": "Battery\n",
    "BAT0/status": "Discharging\n",
  });

  expect(await readPower(runner, "linux", fs)).toBe("battery");
});

it("reads a Linux laptop whose battery is charging or full as AC power", async () => {
  supplies({ "BAT0/type": "Battery\n", "BAT0/status": "Charging\n" });
  expect(await readPower(runner, "linux", fs)).toBe("ac");

  supplies({ "BAT0/type": "Battery\n", "BAT0/status": "Full\n" });
  expect(await readPower(runner, "linux", fs)).toBe("ac");
});

it("reads a host with two batteries as battery when either one discharges", async () => {
  supplies({
    "BAT0/type": "Battery\n",
    "BAT0/status": "Full\n",
    "BAT1/type": "Battery\n",
    "BAT1/status": "Discharging\n",
  });

  expect(await readPower(runner, "linux", fs)).toBe("battery");
});

it("reads a Linux battery whose status is Unknown as unknown, never as AC power", async () => {
  supplies({ "BAT0/type": "Battery\n", "BAT0/status": "Unknown\n" });

  expect(await readPower(runner, "linux", fs)).toBe("unknown");
});

it("reads a Linux battery whose status cannot be read as unknown, never as AC power", async () => {
  supplies({ "BAT0/type": "Battery\n" });

  expect(await readPower(runner, "linux", fs)).toBe("unknown");
});

it("reads a Linux supply whose type cannot be read as unknown, never as AC power", async () => {
  readdir.mockResolvedValue(["BAT0"]);
  readFile.mockRejectedValue(new Error("EACCES"));

  expect(await readPower(runner, "linux", fs)).toBe("unknown");
});

it("reads a Linux host whose power supplies cannot be listed as unknown", async () => {
  readdir.mockRejectedValue(new Error("ENOENT"));

  expect(await readPower(runner, "linux", fs)).toBe("unknown");
});

it("reads a host that is neither macOS nor Linux as unknown and reads nothing", async () => {
  expect(await readPower(runner, "win32", fs)).toBe("unknown");
  expect(run).not.toHaveBeenCalled();
  expect(readdir).not.toHaveBeenCalled();
});

it("reads a Linux battery that discharges ahead of one that cannot be read as battery", async () => {
  supplies({
    "BAT0/type": "Battery\n",
    "BAT0/status": "Discharging\n",
    "BAT1/type": "Battery\n",
  });

  expect(await readPower(runner, "linux", fs)).toBe("battery");
});
