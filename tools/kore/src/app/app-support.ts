// Fakes and fixtures shared by the app domain's unit specs. A support file is
// not a unit, so it needs no spec of its own (ADR 0098).
import { vi } from "vitest";
import type { LockedImage } from "../images/index.js";
import type { Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";

export type Run = Runner["run"];

export const digest = "sha256:" + "a".repeat(64);
export const reference = `registry.kore.local:30500/reference@${digest}`;

export function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

/** A locked image whose fields the app units read; the signer is the only knob. */
export function fakeImage(
  signer = "release@kore.dev",
  imageReference = reference,
): LockedImage {
  return { reference: imageReference, digest, signer } as LockedImage;
}

/** A typed runner whose replies depend on the command and its arguments. */
export function fakeRunner(
  stdout: (command: string, args: readonly string[]) => string = () => "",
) {
  const run = vi.fn<Run>(async (command, args) => ({
    stdout: stdout(command, args),
    stderr: "",
    code: 0,
  }));
  return { runner: { run } as Runner, run };
}

/**
 * A local k3d repository with the fields the app units read. Overrides replace
 * the environment's fields, so `fakeRepository({ provider: "managed" })` is the
 * managed case. The one cast stands in for the rest of the overlay (versions,
 * catalog and so on), which these units never read.
 */
export function fakeRepository(
  environment: Record<string, unknown> = {},
  root = "/repo",
): Repository {
  return {
    root,
    catalog: { components: [] },
    environment: {
      name: "local",
      provider: "k3d",
      kubeContext: "k3d-kore-local",
      gateway: {
        name: "kore-gateway",
        namespace: "kore-system",
        hostname: "kore.local",
      },
      secrets: {
        storeName: "kore-store",
        sourceNamespace: "kore-secret-source",
      },
      telemetry: { otlpEndpoint: "http://otel.kore-system:4318" },
      ...environment,
    },
  } as unknown as Repository;
}
