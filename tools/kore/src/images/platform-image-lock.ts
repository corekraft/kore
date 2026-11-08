import type { Seed } from "../config/types.js";

/**
 * Checks the platform image lock the release workflow emits against the
 * approved list (infra/catalog/seeds.yaml): same images, mirror digests equal
 * to the recorded upstream digests, provenance results that match what the
 * catalog records, and an exact release-tag signer. Returns every problem.
 */

const digestOf = /@(sha256:[0-9a-f]{64})$/;
const releaseSigner =
  /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/\.github\/workflows\/[^@\s/]+@refs\/tags\/v\d+\.\d+\.\d+$/;

const describe = (value: unknown): string =>
  typeof value === "string" ? value : (JSON.stringify(value) ?? "undefined");

type Record_ = Record<string, unknown>;
const isRecord = (value: unknown): value is Record_ =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function provenanceErrors(
  name: string,
  seed: Seed,
  provenance: unknown,
): string[] {
  const recorded = seed.evidence.provenance;
  const result = isRecord(provenance) ? provenance["result"] : undefined;
  if (!recorded.signed) {
    return result === "unsigned-upstream"
      ? []
      : [
          `${name}: unsigned upstream must record provenance result unsigned-upstream, got ${describe(result)}`,
        ];
  }
  if (result !== "verified" || !isRecord(provenance)) {
    return [
      `${name}: signed upstream must record provenance result verified, got ${describe(result)}`,
    ];
  }
  return [
    ...(provenance["identity"] === recorded.identity
      ? []
      : [`${name}: provenance identity differs from the catalog evidence`]),
    ...(provenance["issuer"] === recorded.issuer
      ? []
      : [`${name}: provenance issuer differs from the catalog evidence`]),
  ];
}

function entryErrors(
  name: string,
  seed: Seed,
  entry: unknown,
  authorized: unknown[],
  mirrorBase: string | undefined,
): string[] {
  if (!isRecord(entry)) {
    return [`${name}: entry must be an object`];
  }
  const [reference = "", pinned = ""] = seed.image.split("@");
  const mirror = typeof entry["mirror"] === "string" ? entry["mirror"] : "";
  const mirrored = digestOf.exec(mirror)?.[1];
  const signer = entry["signer"];
  const upstreamDigest = describe(entry["upstreamDigest"]);
  return [
    ...(upstreamDigest === pinned
      ? []
      : [
          `${name}: upstream digest ${upstreamDigest} differs from the catalog pin ${pinned}`,
        ]),
    ...(entry["upstream"] === reference
      ? []
      : [`${name}: upstream must be ${reference}`]),
    ...(mirrored
      ? []
      : [`${name}: mirror must be <registry>/mirror/${name}@sha256:<digest>`]),
    ...(mirrored && mirrored !== pinned
      ? [
          `${name}: mirror digest ${mirrored} differs from upstream ${pinned}; a mirror is a bit-identical copy`,
        ]
      : []),
    ...(mirrorBase && !mirror.startsWith(`${mirrorBase}${name}@`)
      ? [`${name}: mirror must be under ${mirrorBase}${name}`]
      : []),
    ...(typeof signer === "string" && authorized.includes(signer)
      ? []
      : [`${name}: signer ${describe(signer)} is not authorized by the lock`]),
    ...provenanceErrors(name, seed, entry["provenance"]),
  ];
}

export function platformImageLockErrors(
  lock: unknown,
  seeds: Seed[],
): string[] {
  if (!isRecord(lock)) {
    return ["platform image lock must be an object"];
  }
  const entries = lock["entries"];
  const authorized = lock["authorizedSigners"];
  if (
    lock["version"] !== 1 ||
    !isRecord(entries) ||
    !Array.isArray(authorized)
  ) {
    return [
      "platform image lock must have version 1, authorizedSigners, and entries",
    ];
  }
  const signerErrors = authorized.some(
    (s) => typeof s !== "string" || !releaseSigner.test(s),
  )
    ? [
        "authorizedSigners must be exact workflow identities at refs/tags/vX.Y.Z",
      ]
    : [];
  const firstMirror = Object.values(entries).find(isRecord)?.["mirror"];
  const mirrorBase =
    typeof firstMirror === "string" && firstMirror.includes("/mirror/")
      ? `${firstMirror.slice(0, firstMirror.indexOf("/mirror/"))}/mirror/`
      : undefined;
  const bySeed = new Map(seeds.map((seed) => [seed.catalogImage, seed]));
  return [
    ...signerErrors,
    ...seeds
      .filter((seed) => !(seed.catalogImage in entries))
      .map((seed) => `missing approved image ${seed.catalogImage}`),
    ...Object.keys(entries)
      .filter((name) => !bySeed.has(name))
      .map(
        (name) => `unapproved image ${name}: not in infra/catalog/seeds.yaml`,
      ),
    ...[...bySeed].flatMap(([name, seed]) =>
      name in entries
        ? entryErrors(name, seed, entries[name], authorized, mirrorBase)
        : [],
    ),
  ];
}
