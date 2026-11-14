// Fakes shared by the images domain's unit specs. A support file is not a
// unit, so it needs no spec of its own (ADR 0098).
import { createHash, randomBytes, type Hash } from "node:crypto";
import { connect, type TLSSocket } from "node:tls";
import { vi, type MockedFunction } from "vitest";
import type { Repository } from "../config/index.js";
import type { Runner, RunResult } from "../runtime/index.js";

/** A typed runner: `stdout` chooses the reply from the arguments; every call is recorded on `run`. */
export function fakeRunner(
  stdout: (args: readonly string[]) => string = () => "",
): { runner: Runner; run: MockedFunction<Runner["run"]> } {
  const run = vi.fn<Runner["run"]>(
    async (_command, args): Promise<RunResult> => ({
      stdout: stdout(args),
      stderr: "",
      code: 0,
    }),
  );
  return { runner: { run }, run };
}

/**
 * A repository with the fields the images units read. The one cast stands in
 * for the rest of the overlay, which these units never read.
 */
export function fakeRepository(
  environment: Record<string, unknown> = {},
  root = "/repo",
): Repository {
  return asFake<Repository>({
    root,
    environment: {
      name: "local",
      provider: "k3d",
      kubeContext: "k3d-kore-local",
      ...environment,
    },
  });
}

/** What the far end of a TLS socket does: answers with `data`, fails with `error`, closes, or stays silent. */
export type SocketReply =
  { data: string } | { error: Error } | { close: true } | { silent: true };

export interface FakeSocket {
  once: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

/**
 * A TLS socket that plays `reply` as soon as its listener is registered, so a
 * probe resolves on the microtask queue, the way a real handshake does.
 */
export function fakeSocket(reply: SocketReply): FakeSocket {
  const socket: FakeSocket = {
    once: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      if (event === "secureConnect" && "data" in reply) {
        queueMicrotask(() => listener());
      } else if (event === "data" && "data" in reply) {
        queueMicrotask(() => listener(Buffer.from(reply.data)));
      } else if (event === "error" && "error" in reply) {
        queueMicrotask(() => listener(reply.error));
      } else if (event === "close" && "close" in reply) {
        queueMicrotask(() => listener());
      }
      return socket;
    }),
    write: vi.fn(() => true),
    destroy: vi.fn(),
  };
  return socket;
}

/** `connect` returns these sockets, one per probe, in order. */
export function connectTo(...sockets: FakeSocket[]): void {
  for (const socket of sockets) {
    vi.mocked(connect).mockReturnValueOnce(asFake<TLSSocket>(socket));
  }
}

/** A SHA-1 whose digest is `sha:` plus the hashed text, so htpasswd lines are exact. */
export function fakeSha1(): void {
  vi.mocked(createHash).mockImplementation(() => {
    let text = "";
    const hash = {
      update: (value: string) => {
        text = value;
        return hash;
      },
      digest: () => `sha:${text}`,
    };
    return asFake<Hash>(hash);
  });
}

/** Each random password is a fixed label, so the generated Secret data is exact. */
export function fixedPasswords(push: string, read: string): void {
  vi.mocked(randomBytes)
    .mockImplementationOnce(() => asFake<Buffer>({ toString: () => push }))
    .mockImplementationOnce(() => asFake<Buffer>({ toString: () => read }));
}

/** The kubectl arguments of the local registry's port-forward. */
export const forwardArgs = [
  "--context",
  "k3d-kore-local",
  "--namespace",
  "kore-registry",
  "port-forward",
  "service/oci-registry",
  "30500:5000",
];

/** A manifest a registry unit applies, as its stdin carries it. */
export interface Manifest {
  kind: string;
  metadata: { name: string; namespace?: string };
  data?: Record<string, string>;
}

const decode = (value: string | undefined): string =>
  Buffer.from(value ?? "", "base64").toString("utf8");

/** The manifests of the one apply call, parsed from its stdin. */
export function appliedItems(
  calls: readonly (readonly unknown[])[],
): Manifest[] {
  const apply = calls.find((call) => (call[1] as string[]).includes("apply"));
  if (apply === undefined) {
    throw new Error("no apply call was made");
  }
  const list = JSON.parse((apply[2] as { input: string }).input) as {
    items: Manifest[];
  };
  return list.items;
}

/** A Secret's data, decoded from base64, by key. */
export function secretData(
  items: Manifest[],
  name: string,
): Record<string, string> {
  const secret = items.find((item) => item.metadata.name === name);
  return Object.fromEntries(
    Object.entries(secret?.data ?? {}).map(([key, value]) => [
      key,
      decode(value),
    ]),
  );
}

/**
 * The one cast a fake needs. A fake implements the members a unit calls, not
 * the whole Node type it stands in for, so it is handed over as that type here.
 */
export function asFake<T>(fake: unknown): T {
  return fake as T;
}
