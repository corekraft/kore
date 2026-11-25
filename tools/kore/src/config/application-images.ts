// Application image admission in suborg namespaces (issue 1556, ADR 0165, ADR 0166):
// while suborg-image-policy is on, the image-policy chart renders one enforce
// ClusterImagePolicy per app record with a release, over the record's release
// digests, whose Rego policy admits a signature only from the record's repository.
// This module turns the records into the chart's applicationImages value and names
// what kore validate refuses before any cluster. Pure: the reader passes the records in.
// Docs: docs/decisions/0166-an-app-is-a-service-with-a-two-file-record-in-kore-and-its-source-in-its-own-repository.md

import { featureEnabled, suborgImagePolicyFlag } from "./features.js";
import type { ApplicationImage, Repository } from "./types.js";

export type { ApplicationImage } from "./types.js";

/** The release the application images are passed to. */
const imagePolicyComponent = "kore-image-policy";

/** A GitHub repository as a record names it: github.com, an owner and a name, nothing else. */
const githubRepository = /^github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

/** A release's components in the order the policy lists their digests. */
const componentOrder = ["frontend", "bff"];

/** One app record as read: its spec and release manifests, unchecked. */
export interface ApplicationRecord {
  service: string;
  /** The spec file, as a repository path. */
  file: string;
  spec: unknown;
  release: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const specOf = (manifest: unknown): Record<string, unknown> => {
  const spec = isRecord(manifest) ? manifest.spec : undefined;
  return isRecord(spec) ? spec : {};
};

/** The release digests of a record, frontend first. */
function digestsOf(release: unknown): string[] {
  const components = specOf(release).components;
  if (!isRecord(components)) {
    return [];
  }
  return componentOrder.flatMap((name) => {
    const component = components[name];
    const digest = isRecord(component) ? component.digest : undefined;
    return typeof digest === "string" ? [digest] : [];
  });
}

/**
 * The application images of the records: each record whose release carries a
 * digest, with its spec's repository when it names one. A record with no release
 * digest deploys no application image, so it gets no policy.
 */
export function applicationImagesOf(
  records: readonly ApplicationRecord[],
): ApplicationImage[] {
  return records.flatMap(({ service, file, spec, release }) => {
    const digests = digestsOf(release);
    if (digests.length === 0) {
      return [];
    }
    const repository = specOf(spec).repository;
    return [
      {
        service,
        file,
        ...(typeof repository === "string" ? { repository } : {}),
        digests,
      },
    ];
  });
}

/**
 * With suborg-image-policy on, the image-policy chart's applicationImages: each
 * record's service, repository and release digests. Off, nothing, so the
 * flag-off render is unchanged.
 */
export function applicationImageArgs(
  repository: Pick<Repository, "environment" | "applicationImages">,
  component: string,
): string[] {
  if (
    component !== imagePolicyComponent ||
    !featureEnabled(repository.environment, suborgImagePolicyFlag)
  ) {
    return [];
  }
  const images = (repository.applicationImages ?? []).map(
    ({ service, repository: source, digests }) => ({
      service,
      repository: source,
      digests,
    }),
  );
  return ["--set-json", `applicationImages=${JSON.stringify(images)}`];
}

/**
 * What kore validate refuses while suborg-image-policy is on: a trust that is not
 * keyless, since the policy's one authority is the platform workflow identity, and
 * a record whose repository the binding cannot compare with a GitHub workflow's.
 * A missing trust is the existing trust check's to report.
 */
export function applicationImageErrors(
  repository: Pick<
    Repository,
    "environment" | "imageTrustValues" | "applicationImages"
  >,
): string[] {
  if (!featureEnabled(repository.environment, suborgImagePolicyFlag)) {
    return [];
  }
  const trust = repository.imageTrustValues?.trust;
  return [
    ...(isRecord(trust) && trust.type !== "keyless"
      ? [
          `image trust: ${suborgImagePolicyFlag} needs a keyless trust (the platform workflow identity) in the ${imagePolicyComponent} values overlay of environment ${repository.environment.name}; set trust.type keyless, or turn ${suborgImagePolicyFlag} off`,
        ]
      : []),
    ...(repository.applicationImages ?? []).flatMap(recordErrors),
  ];
}

function recordErrors({ file, repository }: ApplicationImage): string[] {
  if (repository === undefined) {
    return [
      `${file}: ${suborgImagePolicyFlag} admits a record's images only when the platform workflow signed them from the record's repository; set spec.repository (github.com/<owner>/<name>), or turn ${suborgImagePolicyFlag} off`,
    ];
  }
  return githubRepository.test(repository)
    ? []
    : [
        `${file}: repository ${repository} is not github.com/<owner>/<name>; ${suborgImagePolicyFlag} binds an image to the GitHub repository its platform workflow ran in, so set spec.repository to github.com/<owner>/<name>, or turn ${suborgImagePolicyFlag} off`,
      ];
}
