import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Repository } from "../config/index.js";
import {
  localRegistryReference,
  localSignArgs,
  publishedDigest,
  publishImageCopy,
  verifiedRegistryAddress,
  withLocalSigner,
  withPublishSession,
  type RegistryClient,
  type RegistryDependencies,
} from "../images/index.js";
import type { Runner } from "../runtime/index.js";

// Docs: docs/decisions/0028-image-trust-authority.md
// Probe images for the opt-in live admission specs: throwaway copies pushed to
// a repository no application uses.

/** Repositories the live specs write to; never used by an application. */
const probeRepository = "kore-admission-probe";

export interface UntrustedImages {
  /** Pushed to the internal registry; nobody signed it. */
  unsigned: string;
  /** Signed with a throwaway key whose public half no policy trusts. */
  foreignSigned: string;
}

export interface ProbeDependencies {
  registry?: RegistryDependencies;
  digest?: (repositoryPath: string, client: RegistryClient) => Promise<string>;
}

type PublishSession = Parameters<Parameters<typeof withPublishSession>[2]>[0];

/** Copies `source` into probe repository `name` with the push identity. */
async function pushProbeCopy(
  repository: Repository,
  runner: Runner,
  session: PublishSession,
  copy: { address: string; source: string; name: string },
  dependencies: ProbeDependencies,
): Promise<string> {
  const path = `${probeRepository}/${copy.name}`;
  await publishImageCopy(
    repository,
    runner,
    { tag: copy.source, address: copy.address, target: `${path}:kore-local` },
    session,
  );
  await localRegistryReference(
    repository,
    runner,
    `${copy.address}/${path}`,
    dependencies.registry,
  );
  const digestOf = dependencies.digest ?? publishedDigest;
  return `${copy.address}/${path}@${await digestOf(path, session.client)}`;
}

/**
 * Copies `source` into its own probe repository and signs it with the
 * cluster's current local signing key through kore's own signer; the private
 * key is only ever named by its k8s:// reference.
 */
export async function publishSignedCopy(
  repository: Repository,
  runner: Runner,
  source: string,
  name: string,
  dependencies: ProbeDependencies = {},
): Promise<string> {
  const address = await verifiedRegistryAddress(repository, runner);
  return await withPublishSession(repository, runner, async (session) =>
    withLocalSigner(repository, runner, async (signer) => {
      const reference = await pushProbeCopy(
        repository,
        runner,
        session,
        { address, source, name },
        dependencies,
      );
      await runner.run(
        "cosign",
        localSignArgs(
          signer.key,
          await localRegistryReference(
            repository,
            runner,
            reference,
            dependencies.registry,
          ),
          session.client.caFile,
        ),
        {
          capture: true,
          env: { ...signer.env, ...session.client.env },
          kubeconfig: signer.kubeconfig,
        },
      );
      return reference;
    }),
  );
}

/**
 * Copies the already-staged `source` image into two probe repositories with
 * the push identity (a signature belongs to its repository, so a copy under a
 * new name carries none), then signs one of them with a key generated in a
 * temporary directory and deleted afterwards. The key never reaches the
 * cluster, the repository, or an argument other than its temporary path.
 */
export async function publishUntrustedCopies(
  repository: Repository,
  runner: Runner,
  source: string,
  dependencies: ProbeDependencies = {},
): Promise<UntrustedImages> {
  const address = await verifiedRegistryAddress(repository, runner);
  return await withPublishSession(repository, runner, async (session) => {
    const published: Record<string, string> = {};
    for (const name of ["unsigned", "foreign-signed"]) {
      published[name] = await pushProbeCopy(
        repository,
        runner,
        session,
        { address, source, name },
        dependencies,
      );
    }
    const foreign = published["foreign-signed"]!;
    const directory = await mkdtemp(join(tmpdir(), "kore-throwaway-key-"));
    try {
      const env = { ...process.env, COSIGN_PASSWORD: "" };
      await runner.run("cosign", ["generate-key-pair"], {
        capture: true,
        cwd: directory,
        env,
      });
      await runner.run(
        "cosign",
        localSignArgs(
          join(directory, "cosign.key"),
          await localRegistryReference(
            repository,
            runner,
            foreign,
            dependencies.registry,
          ),
          session.client.caFile,
        ),
        { capture: true, env: { ...env, ...session.client.env } },
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
    return { unsigned: published["unsigned"]!, foreignSigned: foreign };
  });
}
