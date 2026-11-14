import { describe, expect, it } from "vitest";
import { FAILED, USAGE_ERROR, fail } from "./output.js";
import { fakeDeps } from "./deps-support.js";

describe("the exit codes", () => {
  it("are 1 for a failed command and 2 for a usage error", () => {
    expect(FAILED).toBe(1);
    expect(USAGE_ERROR).toBe(2);
  });
});

describe("fail", () => {
  it("writes the message to stderr and returns the code it was given", () => {
    const deps = fakeDeps();

    const code = fail(deps, false, FAILED, "Pane w3:p9 is busy.");

    expect(code).toBe(FAILED);
    expect(deps.stderr).toHaveBeenCalledExactlyOnceWith(
      "Pane w3:p9 is busy.\n",
    );
  });

  it("writes one JSON error line before the message when --json is set", () => {
    const deps = fakeDeps();

    fail(deps, true, USAGE_ERROR, "Missing --role.");

    expect(deps.stderr).toHaveBeenCalledExactlyOnceWith(
      '{"error":"Missing --role."}\nMissing --role.\n',
    );
  });

  it("writes nothing to stdout, so a failed command leaves no output a caller could parse as success", () => {
    const deps = fakeDeps();

    fail(deps, true, FAILED, "boom");

    expect(deps.stdout).not.toHaveBeenCalled();
  });
});
