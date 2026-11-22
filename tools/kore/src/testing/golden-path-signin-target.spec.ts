import { beforeEach, describe, expect, it, vi } from "vitest";
import { platformPlan, type Environment } from "../config/index.js";
import { goldenPathSignInTarget } from "./golden-path-signin-target.js";

vi.mock("../config/index.js", () => ({
  platformPlan: vi.fn(() => ({
    domain: "kore.internal",
    organizationId: "platform",
  })),
}));

const environment = { name: "local" } as unknown as Environment;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("goldenPathSignInTarget", () => {
  it("targets the Service's host in the platform organization's zone, in the platform realm, on the golden-path sign-in paths", () => {
    expect(goldenPathSignInTarget(environment, "golden-path-example")).toEqual({
      host: "golden-path-example.platform.kore.internal",
      realm: "platform",
      paths: {
        startPath: "/oauth2/authorization/golden-path",
        signedInCallPath: "/api/whoami",
        anonymousPath: "/api/whoami",
      },
    });
    expect(platformPlan).toHaveBeenCalledWith(environment);
  });

  it.each([
    "",
    "Golden",
    "golden.path",
    "-golden",
    "golden-",
    "golden path",
    "golden/../x",
    "golden\n",
    "a".repeat(64),
  ])(
    "refuses the Service name %j by name before any host is built from it",
    (service) => {
      expect(() => goldenPathSignInTarget(environment, service)).toThrow(
        "KORE_SIGNIN_SERVICE must be one DNS label",
      );
      expect(platformPlan).not.toHaveBeenCalled();
    },
  );

  it("accepts a one-label name of 63 characters, the longest a DNS label may be", () => {
    const name = "a".repeat(63);
    expect(goldenPathSignInTarget(environment, name).host).toBe(
      `${name}.platform.kore.internal`,
    );
  });
});
