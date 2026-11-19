// Docs: docs/decisions/0043-platform-configuration-through-argo-cd.md (the handover values)
import { readFile } from "node:fs/promises";
import { beforeEach, expect, test, vi } from "vitest";
import {
  gatewayClassName,
  helmInstalledComponents,
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
    platform: { domain: "kore.local", organizationId: "platform" },
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
  vi.mocked(platformPlan).mockReturnValue({
    domain: "kore.local",
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
      platformDomain: "kore.local",
      gatewayClassName: "agentgateway",
    },
  });
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
