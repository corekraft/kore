// Docs: docs/decisions/0043-platform-configuration-through-argo-cd.md (the handover values)
import { readFile } from "node:fs/promises";
import { beforeEach, expect, test, vi } from "vitest";
import {
  gatewayClassName,
  helmInstalledComponents,
  keycloakHostname,
  platformPlan,
} from "../config/index.js";
import { composeGoldenPathDelivery } from "./golden-path-delivery.js";
import {
  fakeComponent,
  fakeRepository,
  fakeRunner,
} from "./platform-support.js";

vi.mock("node:fs/promises");
vi.mock("../config/index.js");

const sha = "a".repeat(40);
const digest = (c: string) => `sha256:${c.repeat(64)}`;
const base = fakeRepository();
const repository = {
  ...base,
  environment: {
    ...base.environment,
    platform: { domain: "kore.internal", organizationId: "platform" },
    gateway: { namespace: "g", name: "g", port: 8443 },
  },
};
const lock = {
  version: 1,
  authorizedSigners: ["s"],
  entries: {
    "static-frontend": {
      image: "ghcr.io/o/fe",
      digest: digest("1"),
      signer: "s",
    },
    "kotlin-bff": { image: "ghcr.io/o/bff", digest: digest("2"), signer: "s" },
  },
};

function git(remote = "https://github.com/corekraft/kore.git\n") {
  return fakeRunner((_command, args) =>
    args.includes("rev-parse") ? `${sha}\n` : remote,
  );
}

beforeEach(() => {
  vi.mocked(helmInstalledComponents).mockReturnValue([
    fakeComponent({ name: "kore-golden-path-delivery" }),
  ]);
  vi.mocked(gatewayClassName).mockReturnValue("agentgateway");
  vi.mocked(keycloakHostname).mockReturnValue("keycloak.kore.internal");
  vi.mocked(platformPlan).mockReturnValue({
    domain: "kore.internal",
    organizationId: "platform",
  });
  vi.mocked(readFile).mockResolvedValue(JSON.stringify(lock));
});

test("the values carry the lock's digests, the checked-out commit and the environment's domain and gateway class", async () => {
  const { runner, run } = git();
  const composed = await composeGoldenPathDelivery(
    repository,
    runner,
    "template.lock.json",
  );
  expect(readFile).toHaveBeenCalledWith("template.lock.json", "utf8");
  expect(
    run.mock.calls.map(([command, args]) => [command, ...args]),
  ).toContainEqual(["git", "rev-parse", "HEAD"]);
  expect(
    run.mock.calls.every(([, , options]) => options?.cwd === repository.root),
  ).toBe(true);
  expect(composed.goldenPathDelivery).toEqual({
    repoURL: "https://github.com/corekraft/kore.git",
    revision: sha,
    environment: repository.environment.name,
    templateImages: {
      "static-frontend": { image: "ghcr.io/o/fe", digest: digest("1") },
      "kotlin-bff": { image: "ghcr.io/o/bff", digest: digest("2") },
    },
    ingress: {
      platformDomain: "kore.internal",
      gatewayClassName: "agentgateway",
    },
    sharedGateway: false,
    autoscaling: false,
    serviceRecords: false,
  });
});

test("with platform-shared-gateway on the values carry sharedGateway, so the sync labels the app namespaces it creates", async () => {
  const shared = {
    ...repository,
    environment: {
      ...repository.environment,
      features: { "platform-shared-gateway": true },
    },
  };
  const { runner } = git();
  const composed = await composeGoldenPathDelivery(
    shared,
    runner,
    "template.lock.json",
  );
  expect(composed.goldenPathDelivery?.sharedGateway).toBe(true);
});

test("with autoscaling-defaults on the values carry autoscaling, so the Application sets the workload's autoscaler", async () => {
  const autoscaled = {
    ...repository,
    environment: {
      ...repository.environment,
      features: { "autoscaling-defaults": true },
    },
  };
  const { runner } = git();
  const composed = await composeGoldenPathDelivery(
    autoscaled,
    runner,
    "template.lock.json",
  );
  expect(composed.goldenPathDelivery?.autoscaling).toBe(true);
});

test("with autoscaling-defaults off the values carry autoscaling false, so the Application sets no autoscaler", async () => {
  const { runner } = git();
  const composed = await composeGoldenPathDelivery(
    repository,
    runner,
    "template.lock.json",
  );
  expect(composed.goldenPathDelivery?.autoscaling).toBe(false);
});

test("with the flag off the repository is untouched and neither a file nor git is read", async () => {
  vi.mocked(helmInstalledComponents).mockReturnValue([fakeComponent()]);
  const { runner, run } = git();
  await expect(
    composeGoldenPathDelivery(repository, runner, "t.json"),
  ).resolves.toBe(repository);
  expect(readFile).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});

test("a missing template lock flag names the flag and where the lock comes from", async () => {
  await expect(
    composeGoldenPathDelivery(repository, git().runner, undefined),
  ).rejects.toThrow(
    "--platform-template-lock <file> is required while platform-argocd-delivery is on in local; pass the template-images.lock.json attached to the release",
  );
});

test("an unreadable lock names the path", async () => {
  vi.mocked(readFile).mockResolvedValue("nope");
  await expect(
    composeGoldenPathDelivery(repository, git().runner, "t.json"),
  ).rejects.toThrow(
    /^--platform-template-lock t\.json must be the template-images\.lock\.json of a release: /,
  );
});

test.each([
  [
    "a missing entry",
    { version: 1, entries: { "kotlin-bff": lock.entries["kotlin-bff"] } },
  ],
  [
    "a tag instead of a digest",
    {
      version: 1,
      entries: {
        ...lock.entries,
        "kotlin-bff": { image: "ghcr.io/o/bff", digest: "latest" },
      },
    },
  ],
])("%s in the lock is refused before git is asked", async (_title, bad) => {
  vi.mocked(readFile).mockResolvedValue(JSON.stringify(bad));
  const { runner, run } = git();
  await expect(
    composeGoldenPathDelivery(repository, runner, "t.json"),
  ).rejects.toThrow(/template image lock: /);
  expect(run).not.toHaveBeenCalled();
});

test("an origin that is not https is refused with the fix", async () => {
  await expect(
    composeGoldenPathDelivery(
      repository,
      git("git@github.com:corekraft/kore.git\n").runner,
      "t.json",
    ),
  ).rejects.toThrow(
    "the git origin git@github.com:corekraft/kore.git is not an https URL, which the golden-path ApplicationSet needs; set origin to the https URL of the repository",
  );
});

test("with platform-portal, platform-organization-service-apis and platform-argocd-delivery all on, the values carry serviceRecords so the sync also applies the Service records", async () => {
  const all = {
    ...repository,
    environment: {
      ...repository.environment,
      features: {
        "platform-portal": true,
        "platform-organization-service-apis": true,
        "platform-argocd-delivery": true,
      },
    },
  };
  const { runner } = git();
  const composed = await composeGoldenPathDelivery(
    all,
    runner,
    "template.lock.json",
  );
  expect(composed.goldenPathDelivery?.serviceRecords).toBe(true);
});

test("with platform-portal off the values carry serviceRecords false, even with the Service API and Argo CD on, so no environment changes until the portal gate is on", async () => {
  const portalOff = {
    ...repository,
    environment: {
      ...repository.environment,
      features: {
        "platform-portal": false,
        "platform-organization-service-apis": true,
        "platform-argocd-delivery": true,
      },
    },
  };
  const { runner } = git();
  const composed = await composeGoldenPathDelivery(
    portalOff,
    runner,
    "template.lock.json",
  );
  expect(composed.goldenPathDelivery?.serviceRecords).toBe(false);
});

test("with platform-organization-service-apis off the values carry serviceRecords false, so the sync applies no records", async () => {
  const apiOff = {
    ...repository,
    environment: {
      ...repository.environment,
      features: {
        "platform-organization-service-apis": false,
        "platform-argocd-delivery": true,
      },
    },
  };
  const { runner } = git();
  const composed = await composeGoldenPathDelivery(
    apiOff,
    runner,
    "template.lock.json",
  );
  expect(composed.goldenPathDelivery?.serviceRecords).toBe(false);
});

test("with golden-path-signin on the values carry the platform realm's issuer, so each workload's sign-in names it", async () => {
  const signin = {
    ...repository,
    environment: {
      ...repository.environment,
      features: { "golden-path-signin": true },
    },
  };
  const { runner } = git();
  const composed = await composeGoldenPathDelivery(
    signin,
    runner,
    "template.lock.json",
  );
  expect(keycloakHostname).toHaveBeenCalledWith(signin.environment);
  expect(composed.goldenPathDelivery?.signin).toEqual({
    issuerUri: "https://keycloak.kore.internal/realms/platform",
  });
});

test("with golden-path-signin off the values carry no signin key, so the flag-off render is unchanged", async () => {
  const { runner } = git();
  const composed = await composeGoldenPathDelivery(
    repository,
    runner,
    "template.lock.json",
  );
  expect(composed.goldenPathDelivery).not.toHaveProperty("signin");
});
