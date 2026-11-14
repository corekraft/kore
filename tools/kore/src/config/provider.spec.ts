import { expect, test } from "vitest";
import { isLocalProvider } from "./provider.js";
import { fakeEnvironment } from "./config-support.js";

test("only a k3d environment is a local development cluster that Kore creates and trusts", () => {
  expect(isLocalProvider(fakeEnvironment({ provider: "k3d" }))).toBe(true);
});

test("a managed environment is provisioned elsewhere, so it needs no local trust", () => {
  expect(isLocalProvider(fakeEnvironment({ provider: "managed" }))).toBe(false);
});
