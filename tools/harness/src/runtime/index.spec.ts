// The runtime barrel: the one surface other domains import the runtime through.
// Every unit it re-exports is automocked, so each export is checked for identity.
import { expect, it, vi } from "vitest";
import * as runtime from "./index.js";
import * as clock from "./clock.js";
import * as errors from "./errors.js";
import * as filesystem from "./filesystem.js";
import * as hostRoot from "./host-root.js";
import * as hostLoad from "./host-load.js";
import * as ids from "./ids.js";
import * as mainRoot from "./main-root.js";
import * as root from "./root.js";
import * as runner from "./runner.js";
import * as stdin from "./stdin.js";

vi.mock("./clock.js");
vi.mock("./errors.js");
vi.mock("./filesystem.js");
vi.mock("./host-root.js");
vi.mock("./host-load.js");
vi.mock("./ids.js");
vi.mock("./main-root.js");
vi.mock("./root.js");
vi.mock("./runner.js");
vi.mock("./stdin.js");

it("exposes exactly the runtime entry points", () => {
  expect(Object.keys(runtime).sort()).toEqual([
    "CommandError",
    "ProcessRunner",
    "bundleMainRoot",
    "hostLocksDirectory",
    "localDate",
    "mainRoot",
    "nodeFileSystem",
    "readStdin",
    "resolveRoot",
    "systemClock",
    "systemHostLoad",
    "systemIds",
  ]);
});

it("re-exports each entry point from the unit that defines it, unchanged", () => {
  expect(runtime.CommandError).toBe(errors.CommandError);
  expect(runtime.localDate).toBe(clock.localDate);
  expect(runtime.systemClock).toBe(clock.systemClock);
  expect(runtime.systemHostLoad).toBe(hostLoad.systemHostLoad);
  expect(runtime.systemIds).toBe(ids.systemIds);
  expect(runtime.nodeFileSystem).toBe(filesystem.nodeFileSystem);
  expect(runtime.ProcessRunner).toBe(runner.ProcessRunner);
  expect(runtime.hostLocksDirectory).toBe(hostRoot.hostLocksDirectory);
  expect(runtime.mainRoot).toBe(mainRoot.mainRoot);
  expect(runtime.bundleMainRoot).toBe(mainRoot.bundleMainRoot);
  expect(runtime.resolveRoot).toBe(root.resolveRoot);
  expect(runtime.readStdin).toBe(stdin.readStdin);
});
