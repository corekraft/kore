import type { Repository } from "../config/index.js";
import {
  localRegistryReference,
  localSignArgs,
  withLocalSigner,
  withPublishSession,
} from "../images/index.js";
import type { Runner } from "../runtime/index.js";

// Docs: docs/decisions/0028-image-trust-authority.md
// For the opt-in live specs: a spec that replaces the local signing key leaves
// the reference image signed with a key the cluster no longer trusts, and every
// later suite that deploys it is denied. This signs the image again with the
// cluster's current key, whether the spec passed or not.

/**
 * Runs `body`, then signs `image` in place with the cluster's current local
 * signing key through kore's own signer (the private key is only ever named by
 * its k8s:// reference). The signing runs when `body` throws too, and the
 * body's error is what surfaces.
 */
export async function withReferenceSigned<T>(
  repository: Repository,
  runner: Runner,
  image: string,
  body: () => Promise<T>,
): Promise<T> {
  try {
    return await body();
  } finally {
    await withPublishSession(repository, runner, async (session) =>
      withLocalSigner(repository, runner, async (signer) => {
        await runner.run(
          "cosign",
          localSignArgs(
            signer.key,
            await localRegistryReference(repository, runner, image),
            session.client.caFile,
          ),
          {
            capture: true,
            env: { ...signer.env, ...session.client.env },
            kubeconfig: signer.kubeconfig,
          },
        );
      }),
    );
  }
}
