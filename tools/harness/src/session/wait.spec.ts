import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDeps } from "../runtime/index.js";
import {
  asRegistry,
  contextOf,
  fakeDeps,
  fakeRegistry,
  type FakeDeps,
  type FakeRegistry,
} from "./deps-support.js";
import { sessionNameError } from "./names.js";
import { routeSession } from "./backend.js";
import { FAILED, USAGE_ERROR, fail } from "./output.js";
import type { SessionRecord, SessionRegistry } from "./registry.js";
import { DEFAULT_TIMEOUT_MS, parseTimeout, wait } from "./wait.js";

const opener = vi.hoisted(() => ({
  open: vi.fn<(deps: CliDeps) => Promise<SessionRegistry>>(),
}));

vi.mock("./registry.js", () => ({ SessionRegistry: opener }));
vi.mock("./names.js");
vi.mock("./backend.js");
vi.mock("./output.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./output.js")>()),
  fail: vi.fn(),
}));

const RECORD: SessionRecord = {
  version: 1,
  backend: "hc",
  name: "image-trust-writer",
  paneId: "",
  terminal: "t2",
  model: "claude-opus-5-5",
  role: "writer",
  effort: "high",
  createdAt: "2026-01-02T03:04:05.000Z",
};

let deps: FakeDeps;
let registry: FakeRegistry;

beforeEach(() => {
  deps = fakeDeps();
  registry = fakeRegistry();
  registry.read.mockResolvedValue(RECORD);
  opener.open.mockResolvedValue(asRegistry(registry));
  vi.mocked(fail).mockImplementation((_deps, _json, code) => code);
  vi.mocked(routeSession).mockReturnValue({
    error: "routing refused for this test",
  });
});

describe("parseTimeout", () => {
  it("defaults to one hour when no timeout is given", () => {
    expect(parseTimeout(undefined)).toBe(DEFAULT_TIMEOUT_MS);
    expect(DEFAULT_TIMEOUT_MS).toBe(3_600_000);
  });

  it("reads a positive whole number of milliseconds", () => {
    expect(parseTimeout("5000")).toBe(5000);
  });

  it("refuses zero, fractions, words and a bare flag", () => {
    const error = {
      error: "--timeout must be a positive whole number of milliseconds.",
    };
    expect(parseTimeout("0")).toEqual(error);
    expect(parseTimeout("1.5")).toEqual(error);
    expect(parseTimeout("soon")).toEqual(error);
    expect(parseTimeout(true)).toEqual(error);
  });
});

describe("wait", () => {
  it("fails with a usage error when no session name is given", async () => {
    const code = await wait(contextOf(deps));

    expect(code).toBe(USAGE_ERROR);
    expect(fail).toHaveBeenCalledWith(
      deps,
      false,
      USAGE_ERROR,
      "Missing the session name: session wait <name>.",
    );
    expect(opener.open).not.toHaveBeenCalled();
  });

  it("refuses an invalid name with the name error, before opening the registry", async () => {
    vi.mocked(sessionNameError).mockReturnValue("Session names use a-z only.");

    const code = await wait(contextOf(deps, { operand: "Bad Name" }));

    expect(code).toBe(USAGE_ERROR);
    expect(fail).toHaveBeenCalledWith(
      deps,
      false,
      USAGE_ERROR,
      "Session names use a-z only.",
    );
    expect(opener.open).not.toHaveBeenCalled();
  });

  it("refuses a bad --timeout with a usage error", async () => {
    await wait(
      contextOf(deps, {
        operand: "image-trust-writer",
        options: { timeout: "0" },
      }),
    );

    expect(fail).toHaveBeenCalledWith(
      deps,
      false,
      USAGE_ERROR,
      "--timeout must be a positive whole number of milliseconds.",
    );
  });

  it("fails naming the spawn command when no such session was spawned", async () => {
    registry.read.mockResolvedValue(undefined);

    const code = await wait(contextOf(deps, { operand: "image-trust-writer" }));

    expect(code).toBe(FAILED);
    expect(fail).toHaveBeenCalledWith(
      deps,
      false,
      FAILED,
      "No session named image-trust-writer was spawned by this tool; start it with `session spawn`.",
    );
  });

  it("fails with the routing refusal when the record cannot be routed", async () => {
    registry.read.mockResolvedValue(RECORD);
    const code = await wait(contextOf(deps, { operand: "image-trust-writer" }));

    expect(code).toBe(FAILED);
    expect(fail).toHaveBeenCalledWith(
      deps,
      false,
      FAILED,
      "routing refused for this test",
    );
  });
});
