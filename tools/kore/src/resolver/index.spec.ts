// Docs: docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md
import { expect, test, vi } from "vitest";
import * as resolver from "./index.js";
import { resolverChecks } from "./checks.js";
import { systemResolverHost, terminalConfirm } from "./host.js";
import {
  installResolver,
  resolverTarget,
  uninstallResolver,
} from "./resolver.js";

vi.mock("./checks.js");
vi.mock("./host.js");
vi.mock("./resolver.js");

test("the resolver barrel exposes exactly the install, uninstall, check and host entry points", () => {
  expect(Object.keys(resolver).sort()).toEqual([
    "installResolver",
    "isPrivateUseDomain",
    "resolverChecks",
    "resolverDirectory",
    "resolverMarker",
    "resolverState",
    "resolverTarget",
    "systemResolverHost",
    "terminalConfirm",
    "uninstallResolver",
  ]);
  expect(resolver.installResolver).toBe(installResolver);
  expect(resolver.uninstallResolver).toBe(uninstallResolver);
  expect(resolver.resolverTarget).toBe(resolverTarget);
  expect(resolver.resolverChecks).toBe(resolverChecks);
  expect(resolver.systemResolverHost).toBe(systemResolverHost);
  expect(resolver.terminalConfirm).toBe(terminalConfirm);
});
