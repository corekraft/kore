// Shared fakes and fixtures for the secrets unit spec (secrets.spec.ts). A support
// file is not a unit, so it needs no spec of its own (ADR 0098).
import { vi } from "vitest";
import type { Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";

export const NOW = "2026-11-13T10:00:00.000Z";
export const TOKEN = "ab".repeat(32);
export const ROTATION_ID = "01".repeat(8);
export const OTHER_TOKEN = "b".repeat(64);
export const NAMESPACE = "kore-secret-source";
export const CONTEXT = "k3d-kore-local";
export const STATE_DIR = "/repo/.kore/state/environments/local";
export const TOKEN_PATH = `${STATE_DIR}/reference-api-token`;
export const SECRETS_DIR = "/repo/infra/environments/local/secrets";

export const repository = {
  root: "/repo",
  environment: {
    name: "local",
    provider: "k3d",
    kubeContext: CONTEXT,
    secrets: { sourceNamespace: NAMESPACE },
  },
} as unknown as Repository;

export type Run = Runner["run"];

export function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
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

/** The cluster as the sync sees it: whether the source and the ExternalSecret exist. */
export function cluster({
  sourceExists = false,
  externalSecret = false,
}: { sourceExists?: boolean; externalSecret?: boolean } = {}) {
  return (command: string, args: readonly string[]): string => {
    if (command === "sops") {
      return `decrypted:${args[1]}`;
    }
    if (args.includes("externalsecret")) {
      return externalSecret
        ? "externalsecret.external-secrets.io/reference-app\n"
        : "";
    }
    if (args.includes("secret") && args.includes("reference-app")) {
      return sourceExists ? "secret/reference-app\n" : "";
    }
    return "";
  };
}

/** The reference-app source a sync writes, with its rotation id and time. */
export function referenceSecret(token: string, rotationId: string) {
  return {
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name: "reference-app",
      namespace: NAMESPACE,
      labels: { "platform.kore.dev/secret-source": "true" },
      annotations: {
        "platform.kore.dev/rotation-id": rotationId,
        "platform.kore.dev/rotated-at": NOW,
      },
    },
    type: "Opaque",
    data: { API_TOKEN: Buffer.from(token).toString("base64") },
  };
}

/** Every reference-app source applied, parsed from kubectl's stdin. */
export function sourceApplies(run: ReturnType<typeof vi.fn<Run>>) {
  return run.mock.calls.flatMap(([command, , options]) =>
    command === "kubectl" && options?.input?.startsWith("{")
      ? [JSON.parse(options.input)]
      : [],
  );
}
