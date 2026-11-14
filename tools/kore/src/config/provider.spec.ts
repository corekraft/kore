import { expect, test } from "vitest";
import { isLocalProvider } from "./provider.js";
import type { Environment } from "./types.js";

const environment = (provider: string) =>
  ({ provider }) as unknown as Environment;

test("only a k3d environment is a local development cluster that Kore creates and trusts", () => {
  expect(isLocalProvider(environment("k3d"))).toBe(true);
});

test("a managed environment is provisioned elsewhere, so it needs no local trust", () => {
  expect(isLocalProvider(environment("managed"))).toBe(false);
});
