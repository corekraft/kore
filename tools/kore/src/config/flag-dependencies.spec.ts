// Docs: docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md
import { beforeEach, expect, test, vi } from "vitest";
import { fakeEnvironment } from "./config-support.js";
import { featureEnabled } from "./features.js";
import { flagDependencyErrors } from "./flag-dependencies.js";

vi.mock("./features.js", () => ({
  featureEnabled: vi.fn(),
  registryByNameFlag: "registry-by-name",
  platformSharedGatewayFlag: "platform-shared-gateway",
}));

const environment = fakeEnvironment({ name: "local" });

/** Which flags are on; every other flag is off. */
function flagsOn(...on: string[]): void {
  vi.mocked(featureEnabled).mockImplementation((_environment, flag) =>
    on.includes(flag),
  );
}

beforeEach(() => {
  vi.resetAllMocks();
});

test("registry-by-name on with platform-shared-gateway off is refused, naming both flags and the fix", () => {
  flagsOn("registry-by-name");
  expect(flagDependencyErrors(environment)).toEqual([
    'environment local turns on registry-by-name, which needs platform-shared-gateway: its passthrough listener and the registry\'s name are served only through the shared Gateway; set "platform-shared-gateway": true in the local environment overlay, or turn registry-by-name off',
  ]);
});

test("registry-by-name on with platform-shared-gateway on has no error", () => {
  flagsOn("registry-by-name", "platform-shared-gateway");
  expect(flagDependencyErrors(environment)).toEqual([]);
});

test("registry-by-name off needs nothing, whether or not the shared Gateway is on", () => {
  flagsOn();
  expect(flagDependencyErrors(environment)).toEqual([]);
  flagsOn("platform-shared-gateway");
  expect(flagDependencyErrors(environment)).toEqual([]);
});
