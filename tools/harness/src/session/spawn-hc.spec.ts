import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeTerminals } from "../terminal/index.js";
import {
  asRegistry,
  contextOf,
  fakeDeps,
  fakeRegistry,
  type FakeDeps,
} from "./deps-support.js";
import { admit, type Admitted } from "./spawn-hc-admit.js";
import { spawnHc } from "./spawn-hc.js";
import { startSession } from "./spawn-hc-start.js";
import { startLedgerWatch } from "./spawn-hc-watch.js";
import { FAILED, fail } from "./output.js";

vi.mock("./spawn-hc-admit.js");
vi.mock("./spawn-hc-start.js");
vi.mock("./spawn-hc-watch.js");
vi.mock("./output.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./output.js")>()),
  fail: vi.fn(),
}));

let deps: FakeDeps;
let admitted: Admitted;

beforeEach(() => {
  vi.clearAllMocks();
  deps = fakeDeps();
  admitted = {
    requested: {
      values: {
        role: "reader",
        name: "image-trust-reader",
        brief: "Read the rules.",
        model: "claude-sonnet-5-5",
        effort: "high",
      },
      timeoutMs: 60_000,
      tier: { tierSource: "definition" },
    },
    parent: { parent: "t1", delivery: false },
    terminals: new FakeTerminals(),
    reserved: {
      registry: asRegistry(fakeRegistry()),
      cwd: "/repo",
      main: "/main",
    },
  };
  vi.mocked(admit).mockResolvedValue(admitted);
  vi.mocked(startSession).mockResolvedValue({ terminal: "t2" });
  vi.mocked(fail).mockImplementation((_deps, _json, code) => code);
});

describe("spawnHc refuses what admission refuses, and starts nothing", () => {
  it("returns the admission's refusal through fail, and starts no session or watch", async () => {
    vi.mocked(admit).mockResolvedValue({ error: "no parent", code: FAILED });

    await expect(spawnHc(contextOf(deps))).resolves.toBe(FAILED);

    expect(fail).toHaveBeenCalledExactlyOnceWith(
      deps,
      false,
      FAILED,
      "no parent",
    );
    expect(startSession).not.toHaveBeenCalled();
    expect(startLedgerWatch).not.toHaveBeenCalled();
  });

  it("refuses a session hc does not start through fail, and starts no ledger watch", async () => {
    vi.mocked(startSession).mockResolvedValue({
      error: "hc did not start image-trust-reader: no.",
    });

    await expect(spawnHc(contextOf(deps))).resolves.toBe(FAILED);

    expect(fail).toHaveBeenCalledExactlyOnceWith(
      deps,
      false,
      FAILED,
      "hc did not start image-trust-reader: no.",
    );
    expect(startLedgerWatch).not.toHaveBeenCalled();
  });
});

describe("spawnHc starts the ledger watch after the session, under its parent", () => {
  it("starts the watch with the bundle, the main checkout and the parent, then prints and exits 0", async () => {
    await expect(spawnHc(contextOf(deps))).resolves.toBe(0);

    expect(startLedgerWatch).toHaveBeenCalledExactlyOnceWith(
      deps,
      admitted.terminals,
      {
        bundle: "/main/skills/bin/harness.mjs",
        main: "/main",
        parent: "t1",
      },
    );
    expect(deps.stdout).toHaveBeenCalledExactlyOnceWith(
      "Spawned image-trust-reader (claude-sonnet-5-5) on hc terminal t2; collect its result with `session wait image-trust-reader`.\n",
    );
  });

  it("prints a JSON object for a --json caller", async () => {
    await spawnHc(contextOf(deps, { json: true }));

    expect(deps.stdout).toHaveBeenCalledExactlyOnceWith(
      '{"name":"image-trust-reader","terminal":"t2","model":"claude-sonnet-5-5","role":"reader","effort":"high"}\n',
    );
  });
});
