import { registryPlan } from "./registry-address.js";
import type { Repository } from "./types.js";

export const imagePolicyComponent = "kore-image-policy";

const githubIssuer = "https://token.actions.githubusercontent.com";
// The only identity allowed to sign for Kore: a workflow of this repository
// running on an exact release tag. Anything else (branches, pull requests,
// other repositories) is rejected, and so is every wildcard.
const exactReleaseSubject =
  /^https:\/\/github\.com\/corekraft\/kore\/\.github\/workflows\/[A-Za-z0-9._-]+\.ya?ml@refs\/tags\/v\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?$/;
const forbidden = ["subjectRegExp", "issuerRegExp", "subjectRegexp"];

type Trust = Record<string, unknown>;

const isText = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

function keylessErrors(trust: Trust): string[] {
  const subjects = Array.isArray(trust.subjects) ? trust.subjects : [];
  return [
    ...(trust.issuer === githubIssuer
      ? []
      : [`image trust: keyless issuer must be ${githubIssuer}`]),
    ...(subjects.length
      ? []
      : [
          "image trust: keyless needs at least one exact subject (the release workflow identity)",
        ]),
    ...subjects
      .filter((s) => typeof s !== "string" || !exactReleaseSubject.test(s))
      .map(
        (s) =>
          `image trust: subject ${String(s)} must be an exact corekraft/kore workflow on a release tag (https://github.com/corekraft/kore/.github/workflows/<file>.yaml@refs/tags/vX.Y.Z); wildcards, branches, and pull requests are not allowed`,
      ),
    ...(trust.keyRef === undefined
      ? []
      : ["image trust: keyless authority must not also set keyRef"]),
  ];
}

function keyErrors(trust: Trust, repository: Repository): string[] {
  const ref = trust.keyRef as Record<string, unknown> | undefined;
  // Policy Controller only reads key Secrets from its own namespace.
  const controllerNamespace = repository.catalog.components?.find(
    (c) => c.name === "policy-controller",
  )?.namespace;
  return [
    ...(isText(ref?.namespace) &&
    controllerNamespace !== undefined &&
    ref.namespace !== controllerNamespace
      ? [
          `image trust: keyRef.namespace must be ${controllerNamespace}, the policy-controller namespace; Policy Controller cannot read key Secrets elsewhere. Publish a public-key-only Secret there (the local signer does this) and reference it`,
        ]
      : []),
    ...(isText(ref?.name) && isText(ref?.namespace)
      ? []
      : [
          "image trust: key authority needs keyRef.name and keyRef.namespace (the public key Secret)",
        ]),
    ...(trust.issuer !== undefined || trust.subjects !== undefined
      ? [
          "image trust: key authority must not also set keyless issuer or subjects",
        ]
      : []),
  ];
}

const globPattern = (glob: string): RegExp =>
  // nosemgrep: kore-dynamic-regexp -- every glob segment is regex-escaped before interpolation
  new RegExp(
    `^${glob
      .split("**")
      .map((part) =>
        part
          .split("*")
          .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
          .join("[^/]*"),
      )
      .join(".*")}$`,
  );

function canonical(image: string): string {
  const head = image.split("/")[0] ?? "";
  return image.includes("/") && /[.:]|^localhost$/.test(head)
    ? image
    : `docker.io/${image.includes("/") ? image : `library/${image}`}`;
}

/** The glob the image-policy chart renders: the registry address and nothing else. */
export function registryGlob(repository: Repository): string {
  return `${registryPlan(repository.environment).address}/**`;
}

function imageErrors(trust: Trust, repository: Repository): string[] {
  if (trust.images !== undefined) {
    return [
      "image trust: images is derived from registry.address; remove it from the values overlay so the address is written once",
    ];
  }
  if (!parseableAddress(repository)) {
    return [];
  }
  const glob = registryGlob(repository);
  const pattern = globPattern(glob);
  return (repository.seeds?.seeds ?? [])
    .map((s) => canonical(s.image))
    .filter((seed) => pattern.test(seed))
    .map(
      (seed) =>
        `image trust: registry.address glob ${glob} covers seed ${seed}; seeds stay out of scope until they are rolled to signed internal digests`,
    );
}

function parseableAddress(repository: Repository): boolean {
  try {
    registryPlan(repository.environment);
    return true;
  } catch {
    return false;
  }
}

export function imageTrustErrors(repository: Repository): string[] {
  const hasComponent = repository.catalog.components?.some(
    (c) => c.name === imagePolicyComponent,
  );
  if (!hasComponent) {
    return [];
  }
  const trust = repository.imageTrustValues?.trust as Trust | undefined;
  if (!trust || typeof trust !== "object") {
    return [
      `image trust authority is required: set trust in the ${imagePolicyComponent} values overlay of environment ${repository.environment.name} (type: key or keyless)`,
    ];
  }
  const regexps = forbidden
    .filter((name) => name in trust)
    .map(
      (name) =>
        `image trust: ${name} is not allowed (regexp identities admit other workflows or branches); list exact subjects`,
    );
  if (trust.type !== "key" && trust.type !== "keyless") {
    return [...regexps, "image trust: type must be key or keyless"];
  }
  return [
    ...regexps,
    ...(trust.type === "keyless"
      ? keylessErrors(trust)
      : keyErrors(trust, repository)),
    ...imageErrors(trust, repository),
  ];
}
