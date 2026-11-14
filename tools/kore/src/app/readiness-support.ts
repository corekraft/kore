// Fixtures and fakes for the readiness unit's spec. A support file is not a
// unit, so it needs no spec of its own (ADR 0098).
import { createHash } from "node:crypto";
import { vi } from "vitest";
import { assertExpectedCluster } from "../cluster/index.js";
import {
  assertAdmissionGateOpen,
  platformStatus,
  waitForHTTPRoute,
} from "../platform/index.js";
import { fakeRunner } from "./app-support.js";

export const rotationId = "0123456789abcdef";
export const rotatedAt = "2026-11-09T10:00:00.400Z";
/** Refreshed before the rotation, so the Secret is stale. */
export const stale = "2026-11-09T09:59:59Z|True|SecretSynced";
/** Refreshed after the rotation and Ready, so the Secret is current. */
export const fresh = "2026-11-09T10:00:05Z|True|SecretSynced";

/** The HTTPRoute documents `helm get manifest` prints, with one Service that is not a route. */
export function routeManifest(...names: string[]): string {
  return (
    names
      .map(
        (name) =>
          `---\napiVersion: gateway.networking.k8s.io/v1\nkind: HTTPRoute\nmetadata:\n  name: ${name}\nspec: {}\n`,
      )
      .join("") +
    "---\napiVersion: v1\nkind: Service\nmetadata:\n  name: not-a-route\n"
  );
}

/**
 * A runner whose source Secret carries `source` and whose ExternalSecret reads
 * answer `externalSecret(probe)`, probe counting from zero.
 */
export function secretRunner(
  source: string,
  externalSecret: (probe: number) => string,
) {
  let probes = 0;
  return fakeRunner((_command, args) => {
    if (args.includes("secret")) {
      return source;
    }
    if (args.includes("externalsecret") && args.includes("get")) {
      return externalSecret(probes++);
    }
    return "";
  });
}

/** Makes `createHash` return a hash whose digest is `hex`, so the version is checkable. */
export function fakeHash(hex: string): {
  update: ReturnType<typeof vi.fn>;
  digest: ReturnType<typeof vi.fn>;
} {
  const hash = { update: vi.fn(), digest: vi.fn(() => hex) };
  hash.update.mockReturnValue(hash);
  vi.mocked(createHash).mockReturnValue(
    hash as unknown as ReturnType<typeof createHash>,
  );
  return hash;
}

/** One kubectl call as the runner records it: command, arguments and capture. */
export const kubectl = (args: string[], capture = false) => [
  "kubectl",
  args,
  { capture },
];

/** A platform component's status row, as the platform reports it. */
export const component = (componentName: string, status: string, detail = "") =>
  ({ name: componentName, namespace: "kore-system", status, detail }) as never;

/** The readiness unit's collaborators answer healthy: a reachable cluster, an open gate and no route yet ready. */
export function readinessDefaults(): void {
  vi.mocked(assertExpectedCluster).mockResolvedValue();
  vi.mocked(platformStatus).mockResolvedValue([]);
  vi.mocked(assertAdmissionGateOpen).mockResolvedValue("g-abc");
  vi.mocked(waitForHTTPRoute).mockResolvedValue();
}
