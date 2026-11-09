import type { ApprovedEntry } from "../config/index.js";
import { isReleaseAutomationSigner } from "./release-image.js";

/**
 * Checks the platform image lock the release workflow emits against the
 * approved list (infra/catalog/seeds.yaml and approved-images.yaml): same images, mirror digests equal
 * to the recorded upstream digests, provenance results that match what the
 * catalog records, and an exact release-tag signer. Returns every problem.
 */

const digestOf = /@(sha256:[0-9a-f]{64})$/;

const describe = (value: unknown): string =>
  typeof value === "string" ? value : (JSON.stringify(value) ?? "undefined");

type Record_ = Record<string, unknown>;
const isRecord = (value: unknown): value is Record_ =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function provenanceErrors(
  name: string,
  approved: ApprovedEntry,
  provenance: unknown,
): string[] {
  const recorded = approved.evidence.provenance;
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
  approved: ApprovedEntry,
  entry: unknown,
  authorized: unknown[],
  mirrorBase: string | undefined,
): string[] {
  if (!isRecord(entry)) {
    return [`${name}: entry must be an object`];
  }
  const [reference = "", pinned = ""] = approved.image.split("@");
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
    ...provenanceErrors(name, approved, entry["provenance"]),
  ];
}

export function platformImageLockErrors(
  lock: unknown,
  images: ApprovedEntry[],
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
    (s) => typeof s !== "string" || !isReleaseAutomationSigner(s),
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
  const byName = new Map(images.map((image) => [image.name, image]));
  return [
    ...signerErrors,
    ...images
      .filter((image) => !(image.name in entries))
      .map((image) => `missing approved image ${image.name}`),
    ...Object.keys(entries)
      .filter((name) => !byName.has(name))
      .map((name) => `unapproved image ${name}: not in the approved list`),
    ...[...byName].flatMap(([name, approved]) =>
      name in entries
        ? entryErrors(name, approved, entries[name], authorized, mirrorBase)
        : [],
    ),
  ];
}
