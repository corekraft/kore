import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { findRoot } from "../../src/config/index.js";

// Shared by the suborg-image-policy render specs: an offline render of the
// image-policy chart through `helm template`, with the values kore passes it
// (issue 1556). The trust below is the vps overlay's shape: keyless, warn, the
// release workflow's issuer and exact tag subjects, and a signature pull secret.

export const root = await findRoot();
export const chart = join(root, "infra/charts/image-policy");
export const golden = join(
  root,
  "tools/kore/src/platform/fixtures/image-policy.suborg-tenancy-only.yaml",
);

export const issuer = "https://token.actions.githubusercontent.com";
export const subjects = [
  "https://github.com/corekraft/kore/.github/workflows/release.yaml@refs/tags/v0.3.2",
  "https://github.com/corekraft/kore/.github/workflows/release.yaml@refs/tags/v0.4.0",
];

export const keylessTrust = {
  type: "keyless",
  mode: "warn",
  issuer,
  subjects,
  signaturePullSecret: "kore-registry-read",
};

export const keyTrust = {
  type: "key",
  mode: "enforce",
  signaturePullSecret: "kore-registry-read",
  keyRef: { name: "kore-local-signing-pub", namespace: "cosign-system" },
};

const templateTrust = {
  type: "keyless",
  mode: "warn",
  issuer,
  subjects: [
    "https://github.com/corekraft/kore/.github/workflows/release.yaml@refs/tags/v0.22.0",
  ],
};

/** The chart rendered with the platform trust given and the extra Helm arguments, as kore passes them. */
export function render(
  trust: Record<string, unknown>,
  ...extra: string[]
): string {
  return execFileSync(
    "helm",
    [
      "template",
      "kore-image-policy",
      chart,
      "--set-string",
      "platform.registry.address=registry.example:5000",
      "--set-json",
      `trust=${JSON.stringify(trust)}`,
      "--set-json",
      `templates.trust=${JSON.stringify(templateTrust)}`,
      "--set",
      "features.golden-path-template-admission=true",
      "--set",
      "features.suborg-tenancy=true",
      ...extra,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

/** The flag on, as kore's feature arguments pass it. */
export const imagePolicyOn = ["--set", "features.suborg-image-policy=true"];

/** The application images of the given records, as kore passes them. */
export function records(images: readonly unknown[]): string[] {
  return ["--set-json", `applicationImages=${JSON.stringify(images)}`];
}

/** The documents of a render, each as one string, without the empty ones. */
export function documents(rendered: string): string[] {
  return rendered
    .split(/^---$/m)
    .map((document) => document.trim())
    .filter((document) => document !== "");
}

/** The rendered document whose metadata name is the given one, or undefined. */
export function named(rendered: string, name: string): string | undefined {
  return documents(rendered).find((document) =>
    new RegExp(`^  name: ${name}$`, "m").test(document),
  );
}

/** The ClusterImagePolicy names a render holds, in order. */
export function policyNames(rendered: string): string[] {
  return documents(rendered).flatMap(
    (document) => /^  name: (\S+)$/m.exec(document)?.[1] ?? [],
  );
}
