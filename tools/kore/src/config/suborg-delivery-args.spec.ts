// Docs: docs/decisions/0165-a-suborg-is-the-namespace-quota-and-trust-boundary-of-its-services.md
import { beforeEach, expect, test, vi } from "vitest";
import { fakeEnvironment } from "./config-support.js";
import { featureEnabled } from "./features.js";
import { suborgDeliveryArgs } from "./suborg-delivery-args.js";
import type { Repository } from "./types.js";

// Issue 1553: with suborg-delivery-project on, the platform-apis chart takes the Kore
// repository URL its suborg AppProjects admit as their one source. The URL is composed from
// the git origin before any command renders, so the argument is the composed field.

vi.mock("./features.js", () => ({
  featureEnabled: vi.fn(),
  suborgDeliveryProjectFlag: "suborg-delivery-project",
}));

const repoURL = "https://github.com/corekraft/kore.git";

/** A repository whose Kore URL is composed, or not. */
function repository(
  composed: boolean,
): Pick<Repository, "environment" | "suborgDelivery"> {
  return {
    environment: fakeEnvironment(),
    suborgDelivery: composed ? { repoURL } : undefined,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(featureEnabled).mockReturnValue(true);
});

test("with suborg-delivery-project off the platform-apis chart takes no repository URL", () => {
  vi.mocked(featureEnabled).mockReturnValue(false);
  expect(
    suborgDeliveryArgs(repository(true), "kore-platform-apis"),
  ).toStrictEqual([]);
});

test("with suborg-delivery-project on the platform-apis chart takes the composed Kore repository URL", () => {
  expect(
    suborgDeliveryArgs(repository(true), "kore-platform-apis"),
  ).toStrictEqual(["--set-string", `suborgDelivery.repoURL=${repoURL}`]);
});

test("only the platform-apis chart takes the repository URL, not any other component", () => {
  expect(
    suborgDeliveryArgs(repository(true), "kore-golden-path-delivery"),
  ).toStrictEqual([]);
});

test("with the flag on but no URL composed, no URL is passed, so the chart refuses to render naming the field", () => {
  expect(
    suborgDeliveryArgs(repository(false), "kore-platform-apis"),
  ).toStrictEqual([]);
});
