// Docs: docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md
import { beforeEach, expect, test, vi } from "vitest";
import { featureEnabled } from "./features.js";
import { internalGateway } from "./gateways.js";
import {
  clusterResolutionArgs,
  localCaConfigMap,
} from "./platform-cluster-resolution.js";
import type { Environment } from "./types.js";

vi.mock("./features.js", () => ({
  featureEnabled: vi.fn(),
  platformDnsFlag: "platform-dns",
}));
vi.mock("./gateways.js", () => ({ internalGateway: vi.fn() }));

const environment = { name: "local" } as Environment;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(featureEnabled).mockReturnValue(true);
  vi.mocked(internalGateway).mockReturnValue({
    name: "kore-gateway",
    namespace: "kore-system",
  } as ReturnType<typeof internalGateway>);
});

test("the CA ConfigMap name is the one the portal and local trust installs use", () => {
  expect(localCaConfigMap).toBe("kore-local-ca");
});

test("with platform-dns off, no component takes a resolution argument", () => {
  vi.mocked(featureEnabled).mockReturnValue(false);
  expect(clusterResolutionArgs(environment, "kore-platform-backstage")).toEqual(
    [],
  );
  expect(clusterResolutionArgs(environment, "kore-platform-dns")).toEqual([]);
});

test("with platform-dns on, the portal is handed the CA ConfigMap it trusts", () => {
  expect(clusterResolutionArgs(environment, "kore-platform-backstage")).toEqual(
    ["--set-string", "localCa.configMap=kore-local-ca"],
  );
});

test("with platform-dns on, platform-dns is handed the Gateway whose Service the zone rewrites to", () => {
  expect(clusterResolutionArgs(environment, "kore-platform-dns")).toEqual([
    "--set-string",
    "gateway.name=kore-gateway",
    "--set-string",
    "gateway.namespace=kore-system",
  ]);
});

test("no other component takes a resolution argument, even with platform-dns on", () => {
  expect(clusterResolutionArgs(environment, "kore-platform-config")).toEqual(
    [],
  );
});
