import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { loadRepository } from "../src/config/index.js";
import { defaultPlatformDomain } from "../src/platform-domain.fixtures.js";
import {
  escapeRegExp,
  localPlatform,
  platformOf,
} from "./local-platform-support.js";

// Docs: docs/decisions/0042-organization-domains-by-delegation.md
// The integration specs name the platform through the local overlay's platform
// field and gateway port, so the one default changes in one place (#1214).

const here = dirname(fileURLToPath(import.meta.url));
const thisFolder = (file: string): boolean =>
  ["local-platform-names.spec.ts", "local-platform-support.ts"].includes(
    relative(here, file),
  );

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sources(path) : [path];
  });
}

test("no integration spec hardcodes the platform domain, the gateway port or the registry port", () => {
  const hardcoded = /kore\\*\.local|\b8443\b|\b30500\b/;
  const offenders = sources(here)
    .filter((file) => !thisFolder(file))
    .filter((file) => hardcoded.test(readFileSync(file, "utf8")))
    .map((file) => relative(here, file));
  expect(offenders).toEqual([]);
});

test("the names follow the overlay's platform domain and gateway port", async () => {
  const { environment } = await loadRepository("local");
  const moved = platformOf({
    ...environment,
    platform: { domain: "kore.internal", organizationId: "platform" },
    gateway: { ...environment.gateway, port: 443 },
  });
  expect(moved).toEqual({
    domain: "kore.internal",
    registryHost: "registry.kore.internal",
    registry: "registry.kore.internal:30500",
    registryPort: 30500,
    registryName: "registry.platform.kore.internal",
    gatewayPort: 443,
    hostPort: environment.k3d?.ports[0]?.hostPort,
  });
});

test("the local overlay's own values are what the specs read", async () => {
  const { environment } = await loadRepository("local");
  const local = await localPlatform();
  expect(local.domain).toBe(environment.platform?.domain);
  expect(local.gatewayPort).toBe(environment.gateway.port);
  expect(local.hostPort).toBe(environment.k3d?.ports[0]?.hostPort);
});

test("the local overlay moves the platform to kore.internal and keeps kore.local as the deprecated alias", async () => {
  const { environment } = await loadRepository("local");
  expect(environment.platform).toEqual({
    domain: "kore.internal",
    organizationId: "platform",
    deprecatedAlias: "kore.local",
  });
});

test("the unit fixtures' default platform domain is the local overlay's platform.domain", async () => {
  const { environment } = await loadRepository("local");
  expect(defaultPlatformDomain).toBe(environment.platform?.domain);
});

test("a platform name is escaped to match literally inside a regular expression", () => {
  expect(new RegExp(escapeRegExp("a.b+c")).test("a.b+c")).toBe(true);
  expect(new RegExp(escapeRegExp("a.b+c")).test("aXb+c")).toBe(false);
});
