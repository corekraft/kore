// Fakes and fixtures shared by the local domain's unit specs. A support file is
// not a unit, so it needs no spec of its own (ADR 0098).
import { vi } from "vitest";
import type { Repository } from "../config/index.js";
import type {
  BuiltLocalImage,
  LockedImage,
  loadImageLock,
} from "../images/index.js";
import { CommandError, type Runner } from "../runtime/index.js";

type ImageLock = Awaited<ReturnType<typeof loadImageLock>>;

export const digest = `sha256:${"a".repeat(64)}`;

/** The failure a docker command reports when no daemon is running. */
export function noDaemon(): CommandError {
  return new CommandError("docker", ["image", "ls"], {
    stdout: "",
    stderr: "no daemon",
    code: 1,
  });
}

/** The text the local lock is written with after one application is built and signed. */
export function signedLocalLock(): string {
  return JSON.stringify(
    {
      version: 1,
      authorizedSigners: ["local-kore-key"],
      entries: {
        reference: {
          image: "registry.kore.local:30500/reference",
          digest,
          signer: "local-kore-key",
        },
      },
    },
    null,
    2,
  );
}

/** A typed runner. The local units hand it on and never run a process of their own. */
export function fakeRunner() {
  const run = vi.fn<Runner["run"]>(async () => ({
    stdout: "",
    stderr: "",
    code: 0,
  }));
  return { runner: { run } as Runner, run };
}

/**
 * A repository with the fields the local lifecycle reads: the root and the
 * environment's name and provider. Overrides replace the environment's fields,
 * so `fakeRepository({ provider: "managed" })` is the managed case. The one
 * cast stands in for the rest of the overlay, which these units never read.
 */
export function fakeRepository(
  environment: Record<string, unknown> = {},
  root = "/repo",
): Repository {
  return {
    root,
    environment: { name: "local", provider: "k3d", ...environment },
  } as unknown as Repository;
}

/** Where the local image lock of the environment `local` lives under `root`. */
export function localLockPath(root = "/repo"): string {
  return `${root}/.kore/state/environments/local/local-images.lock.json`;
}

/** Where the local signing public key of the environment `local` lives under `root`. */
export function localPublicKeyPath(root = "/repo"): string {
  return `${root}/.kore/state/environments/local/local-signing.pub`;
}

/** The committed image lock, with one entry per application name given. */
export function imageLock(...applications: string[]): ImageLock {
  return {
    version: 1,
    authorizedSigners: ["local-kore-key"],
    entries: Object.fromEntries(
      applications.map((application) => [
        application,
        {
          image: `registry.kore.local:30500/${application}`,
          digest: `sha256:${"b".repeat(64)}`,
          signer: "local-kore-key",
        },
      ]),
    ),
  };
}

/** What building one application's image hands back: its signed reference and the public key. */
export function builtImage(application: string): BuiltLocalImage {
  const image: LockedImage = {
    reference: `registry.kore.local:30500/${application}@${digest}`,
    digest,
    signer: "local-kore-key",
  };
  return { image, publicKey: localPublicKeyPath() };
}
