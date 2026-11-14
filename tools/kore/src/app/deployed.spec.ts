// Docs: docs/decisions/0063-lifecycle-resume-and-release-only-app-up.md
import { beforeEach, expect, test, vi } from "vitest";
import {
  isReleaseAutomationSigner,
  type LockedImage,
} from "../images/index.js";
import {
  digest,
  fakeImage,
  fakeRepository,
  fakeRunner,
} from "./app-support.js";
import { deployedImage } from "./deployed.js";

vi.mock("../images/index.js");

const name = "reference";
const releaseSigner = "release@kore.dev";
const locked = (signer = releaseSigner): LockedImage => fakeImage(signer);

/** Answers the two reads: the release's user values and the namespace label. */
function cluster(options: { values: string; enrolled?: string }) {
  return fakeRunner((command, args) => {
    if (command === "helm") {
      return options.values;
    }
    return args.includes(
      "jsonpath={.metadata.labels.policy\\.sigstore\\.dev/include}",
    )
      ? (options.enrolled ?? "true")
      : "";
  });
}

beforeEach(() => {
  vi.mocked(isReleaseAutomationSigner).mockImplementation(
    (signer) => signer === releaseSigner,
  );
});

test("status reports the deployed digest, its registry, the signer identity and the namespace enrollment", async () => {
  const { runner } = cluster({
    values: JSON.stringify({ image: { digest } }),
  });
  await expect(
    deployedImage(fakeRepository(), runner, name, locked()),
  ).resolves.toEqual({
    digest,
    registry: "registry.kore.local:30500",
    matchesLock: true,
    signer: releaseSigner,
    signerKind: "release-automation",
    namespaceImageEnforcement: "enrolled",
    environmentImageInventory: "audit",
  });
});

test("status says so when the deployed digest differs from the lock", async () => {
  const other = "sha256:" + "b".repeat(64);
  const { runner } = cluster({
    values: JSON.stringify({ image: { digest: other } }),
  });
  await expect(
    deployedImage(fakeRepository(), runner, name, locked()),
  ).resolves.toMatchObject({ digest: other, matchesLock: false });
});

test("a local developer signature is named as one, never as release automation", async () => {
  const { runner } = cluster({ values: JSON.stringify({ image: { digest } }) });
  await expect(
    deployedImage(fakeRepository(), runner, name, locked("local-kore-key")),
  ).resolves.toMatchObject({ signerKind: "local-developer-key" });
});

test("any other signer is reported as other, not as release automation", async () => {
  const { runner } = cluster({ values: JSON.stringify({ image: { digest } }) });
  await expect(
    deployedImage(
      fakeRepository(),
      runner,
      name,
      locked(
        "https://github.com/someone/else/.github/workflows/x.yaml@refs/tags/v1",
      ),
    ),
  ).resolves.toMatchObject({ signerKind: "other" });
});

test("a namespace without the admission label reports not enrolled", async () => {
  const { runner } = cluster({
    values: JSON.stringify({ image: { digest } }),
    enrolled: "",
  });
  await expect(
    deployedImage(fakeRepository(), runner, name, locked()),
  ).resolves.toMatchObject({ namespaceImageEnforcement: "not enrolled" });
});

test("a release that reports no digest leaves the digest unknown instead of guessing one", async () => {
  const { runner } = cluster({ values: JSON.stringify({ image: {} }) });
  await expect(
    deployedImage(fakeRepository(), runner, name, locked()),
  ).resolves.toMatchObject({ digest: "unknown", matchesLock: false });
});

test("values that are not JSON leave the digest unknown rather than failing status", async () => {
  const { runner } = cluster({ values: "not json" });
  await expect(
    deployedImage(fakeRepository(), runner, name, locked()),
  ).resolves.toMatchObject({ digest: "unknown" });
});

test("status reads the release's user values as JSON in the configured context, never every value or a Secret", async () => {
  const { runner, run } = cluster({
    values: JSON.stringify({ image: { digest } }),
  });
  await deployedImage(fakeRepository(), runner, name, locked());
  expect(run.mock.calls).toEqual([
    [
      "helm",
      [
        "get",
        "values",
        name,
        `--namespace=${name}`,
        "--kube-context",
        "k3d-kore-local",
        "--output",
        "json",
      ],
      { capture: true },
    ],
    [
      "kubectl",
      [
        "--context",
        "k3d-kore-local",
        "get",
        "namespace",
        name,
        "--output",
        "jsonpath={.metadata.labels.policy\\.sigstore\\.dev/include}",
      ],
      { capture: true },
    ],
  ]);
  expect(JSON.stringify(run.mock.calls)).not.toMatch(/--all|secret/i);
});

test("the environment's image inventory mode is reported as configured, defaulting to audit", async () => {
  const { runner } = cluster({ values: JSON.stringify({ image: { digest } }) });
  await expect(
    deployedImage(
      fakeRepository({ imageInventory: "enforce" }),
      runner,
      name,
      locked(),
    ),
  ).resolves.toMatchObject({ environmentImageInventory: "enforce" });
});
