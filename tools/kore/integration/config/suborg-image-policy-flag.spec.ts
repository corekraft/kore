import assert from "node:assert/strict";
import { test } from "vitest";
import {
  appliedFlags,
  featureEnabled,
  flagEntry,
  loadRepository,
  requiredFlags,
  validateRepository,
} from "../../src/config/index.js";
import type { Repository } from "../../src/config/index.js";

// Docs: docs/decisions/0165-a-suborg-is-the-namespace-quota-and-trust-boundary-of-its-services.md (image admission)
// Issue 1556: application images in suborg namespaces are admitted only when the platform
// workflow signed them from their record's repository, in enforce. It has its own flag,
// which needs suborg-tenancy (the enrolled suborg namespaces), so the flag stays dark until
// a recorded live outcome (#1559).

const flag = "suborg-image-policy";
const overlays = ["local", "vps", "managed-example"];
const digest = `sha256:${"a".repeat(64)}`;

/** The repository of an overlay with the given flags set; every other flag is the overlay's own. */
async function withFlags(
  name: string,
  set: Record<string, boolean>,
  extra: Partial<Repository> = {},
): Promise<Repository> {
  const base = await loadRepository(name);
  return {
    ...base,
    ...extra,
    environment: {
      ...base.environment,
      features: { ...base.environment.features, ...set },
    },
  };
}

/** The message a validation failure carries. */
async function refusal(repository: Repository): Promise<string> {
  let message = "";
  await assert.rejects(validateRepository(repository), (error: unknown) => {
    message = error instanceof Error ? error.message : String(error);
    return true;
  });
  return message;
}

/** The flag and suborg-tenancy on, with the flags suborg-tenancy itself requires. */
const bothOn = {
  [flag]: true,
  "suborg-tenancy": true,
  "platform-organization-service-apis": true,
  "platform-argocd-delivery": true,
  "platform-portal": true,
};

test("suborg-image-policy is declared false in every overlay, so application image admission stays dark until a recorded live outcome", async () => {
  for (const name of overlays) {
    const repository = await loadRepository(name);
    assert.equal(repository.environment.features?.[flag], false, name);
    assert.equal(featureEnabled(repository.environment, flag), false, name);
  }
});

test("suborg-image-policy is a feature flag in the manifest that applies to every overlay", async () => {
  const { flags } = await loadRepository("local");
  assert.equal(flagEntry(flags, flag)?.kind, "feature");
  for (const name of overlays) {
    assert.ok(
      appliedFlags(flags, name).includes(flag),
      `${name} lists the flag`,
    );
  }
});

test("suborg-image-policy needs suborg-tenancy, and nothing else", async () => {
  const { flags } = await loadRepository("local");
  assert.deepEqual(requiredFlags(flags, flag), ["suborg-tenancy"]);
});

test("turning suborg-image-policy on without suborg-tenancy fails validation, naming both flags and the fix", async () => {
  assert.match(
    await refusal(
      await withFlags("vps", { [flag]: true, "suborg-tenancy": false }),
    ),
    /flag suborg-image-policy is on in the vps overlay but requires suborg-tenancy, which is off there; set "suborg-tenancy": true in the vps overlay, or turn suborg-image-policy off/,
  );
});

test("turning suborg-image-policy on in local fails validation, since local's key trust is not the platform workflow identity, naming the flag and the fix", async () => {
  assert.match(
    await refusal(await withFlags("local", bothOn)),
    /image trust: suborg-image-policy needs a keyless trust \(the platform workflow identity\) in the kore-image-policy values overlay of environment local; set trust\.type keyless, or turn suborg-image-policy off/,
  );
});

test("turning suborg-image-policy on with suborg-tenancy on passes validation in vps", async () => {
  await validateRepository(await withFlags("vps", bothOn));
});

test("with suborg-image-policy on, a record with a release digest and no repository fails validation, naming the record, the flag and the fix", async () => {
  assert.match(
    await refusal(
      await withFlags("vps", bothOn, {
        applicationImages: [
          {
            service: "checkout",
            file: "infra/environments/vps/services/checkout.json",
            digests: [digest],
          },
        ],
      }),
    ),
    /infra\/environments\/vps\/services\/checkout\.json: suborg-image-policy admits a record's images only when the platform workflow signed them from the record's repository; set spec\.repository \(github\.com\/<owner>\/<name>\), or turn suborg-image-policy off/,
  );
});

test("with suborg-image-policy on, a record whose repository is not on github.com fails validation, since the platform workflow signs only from GitHub", async () => {
  assert.match(
    await refusal(
      await withFlags("vps", bothOn, {
        applicationImages: [
          {
            service: "checkout",
            file: "infra/environments/vps/services/checkout.json",
            repository: "example.org/leads/checkout",
            digests: [digest],
          },
        ],
      }),
    ),
    /infra\/environments\/vps\/services\/checkout\.json: repository example\.org\/leads\/checkout is not github\.com\/<owner>\/<name>; suborg-image-policy binds an image to the GitHub repository its platform workflow ran in, so set spec\.repository to github\.com\/<owner>\/<name>, or turn suborg-image-policy off/,
  );
});

test("with suborg-image-policy on, a record on github.com passes validation in vps", async () => {
  await validateRepository(
    await withFlags("vps", bothOn, {
      applicationImages: [
        {
          service: "checkout",
          file: "infra/environments/vps/services/checkout.json",
          repository: "github.com/example-org/checkout",
          digests: [digest],
        },
      ],
    }),
  );
});
