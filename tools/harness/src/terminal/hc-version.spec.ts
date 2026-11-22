import { beforeEach, describe, expect, it, vi } from "vitest";
import { PIN_INSTALL, failed, ok, scripted } from "./hc-terminals-support.js";

// terminalError is a function with behaviour, so it is a double (ADR 0098).
vi.mock("./port.js", () => ({
  terminalError: vi.fn((kind: string, message: string, hint?: string) => ({
    error: { kind, message, hint },
  })),
}));

// The check runs once per process, so each test loads a fresh module.
let checkHcVersion: typeof import("./hc-version.js").checkHcVersion;
beforeEach(async () => {
  vi.resetModules();
  ({ checkHcVersion } = await import("./hc-version.js"));
});

describe("checkHcVersion", () => {
  it("passes when hc --version prints the pin, and runs hc only once per process", async () => {
    const runner = scripted(ok("hc 0.1.21\n"));
    expect(await checkHcVersion(runner)).toBeUndefined();
    expect(await checkHcVersion(runner)).toBeUndefined();
    expect(runner.run.mock.calls).toEqual([["hc", ["--version"]]]);
  });

  it("fails closed on a mismatched version, naming the pin and the install command", async () => {
    expect(await checkHcVersion(scripted(ok("hc 0.1.20\n")))).toEqual({
      error: {
        kind: "unavailable",
        message: "hc 0.1.20 is installed, but kore pins hc 0.1.21",
        hint: PIN_INSTALL,
      },
    });
  });

  it("fails closed when hc is missing, naming the pin and the install command", async () => {
    expect(
      await checkHcVersion(scripted(failed(127, "spawn hc ENOENT"))),
    ).toEqual({
      error: {
        kind: "unavailable",
        message:
          "hc is not installed or not on PATH: hc --version exited with code 127",
        hint: PIN_INSTALL,
      },
    });
  });

  it("keeps a failed check for the rest of the process, so later calls fail the same way without running hc", async () => {
    const runner = scripted(failed(127, "spawn hc ENOENT"));
    const first = await checkHcVersion(runner);
    expect(await checkHcVersion(runner)).toEqual(first);
    expect(runner.run.mock.calls).toHaveLength(1);
  });
});
