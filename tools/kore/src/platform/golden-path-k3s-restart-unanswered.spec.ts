import { describe, expect, test } from "vitest";
import { CommandError, CommandTimeoutError } from "../runtime/index.js";
import { isUnansweredRead } from "./golden-path-k3s-restart-support.js";

const failed = { stdout: "", stderr: "connection refused", code: 1 };

describe("which error during a kubectl read is an unanswered read", () => {
  test("counts a kubectl command that failed as unanswered, since the API server did not answer", () => {
    expect(
      isUnansweredRead(new CommandError("kubectl", ["get", "--raw"], failed)),
    ).toBe(true);
  });

  test("counts a kubectl command killed for hanging as unanswered too, since it never answered", () => {
    expect(
      isUnansweredRead(
        new CommandTimeoutError("kubectl", ["get"], failed, 10_000, false),
      ),
    ).toBe(true);
  });

  test("rethrows a JSON parse failure rather than counting it as an outage, so a bug names its own cause", () => {
    expect(
      isUnansweredRead(new SyntaxError("Unexpected token < in JSON")),
    ).toBe(false);
  });

  test("rethrows a TypeError rather than counting it as an outage, so a bug is not reported as a timeout", () => {
    expect(
      isUnansweredRead(new TypeError("Cannot read properties of undefined")),
    ).toBe(false);
  });
});
