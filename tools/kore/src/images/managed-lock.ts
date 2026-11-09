import { approvedImageList, type Repository } from "../config/index.js";
import { platformImageLockErrors } from "./platform-image-lock.js";

/**
 * Checks a release's platform image lock against a managed environment's
 * committed overlay (ADR 0044): the lock is the approved list at that release,
 * so its digests must be the ones the overlay and charts already pin; its
 * mirror references must sit under the environment's platformMirror; and every
 * identity that signed it must be one the environment's image policy admits.
 * Nothing here trusts the lock for authority; admission still verifies each
 * signature.
 */
export function managedLockErrors(
  lock: unknown,
  repository: Repository,
): string[] {
  const { environment } = repository;
  const mirror = environment.platformMirror;
  if (mirror === undefined) {
    return [
      `environment ${environment.name} declares no platformMirror; there is no managed overlay to check the lock against`,
    ];
  }
  const approved = approvedImageList(repository);
  const entries = (lock as { entries?: Record<string, { mirror?: unknown }> })
    ?.entries;
  const misplaced = approved.flatMap(({ name }) => {
    const reference = entries?.[name]?.mirror;
    return typeof reference === "string" &&
      !reference.startsWith(`${mirror}/${name}@`)
      ? [
          `${name}: lock mirror ${reference} is not under platformMirror ${mirror} of environment ${environment.name}`,
        ]
      : [];
  });
  const trust = repository.imageTrustValues?.["trust"] as
    { subjects?: string[] } | undefined;
  const signers = (lock as { authorizedSigners?: unknown })?.authorizedSigners;
  const unadmitted = (Array.isArray(signers) ? signers : []).flatMap(
    (signer) =>
      typeof signer === "string" && !trust?.subjects?.includes(signer)
        ? [
            `lock signer ${signer} is not admitted by kore-image-policy in environment ${environment.name}; add it to trust.subjects in its values overlay`,
          ]
        : [],
  );
  return [
    ...platformImageLockErrors(lock, approved),
    ...misplaced,
    ...unadmitted,
  ];
}
