// Docs: docs/decisions/0028-image-trust-authority.md
import { beforeEach, expect, test, vi } from "vitest";
import type { Repository } from "../config/index.js";
import {
  localRegistryReference,
  localSignArgs,
  withLocalSigner,
  withPublishSession,
} from "../images/index.js";
import type { Runner } from "../runtime/index.js";
import { withReferenceSigned } from "./reference-restore.js";

vi.mock("../images/index.js");

type Run = Runner["run"];

const IMAGE = `10.96.0.50:5000/reference/app@sha256:${"a".repeat(64)}`;
const repository = {
  environment: { name: "local" },
} as unknown as Repository;
const session = {
  client: { caFile: "/ca/registry.pem", env: { REGISTRY: "1" } },
} as never;
const signer = {
  key: "k8s://kore-system/signing",
  env: { SIGNER: "1" },
  kubeconfig: "/kube/config",
} as never;

function fakeRunner() {
  const run = vi.fn<Run>(async () => ({ stdout: "", stderr: "", code: 0 }));
  return { runner: { run } as Runner, run };
}

beforeEach(() => {
  vi.mocked(localRegistryReference).mockImplementation(
    async (_repository, _runner, reference) => reference,
  );
  vi.mocked(localSignArgs).mockImplementation((key, reference, caFile) => [
    "sign",
    key,
    reference,
    caFile,
  ]);
  vi.mocked(withPublishSession).mockImplementation(async (_r, _run, work) =>
    work(session),
  );
  vi.mocked(withLocalSigner).mockImplementation(async (_r, _run, work) =>
    work(signer),
  );
});

test("after the body finishes, the reference image is signed again with the current key through cosign", async () => {
  const { runner, run } = fakeRunner();

  await withReferenceSigned(repository, runner, IMAGE, async () => undefined);

  expect(run).toHaveBeenCalledExactlyOnceWith(
    "cosign",
    ["sign", "k8s://kore-system/signing", IMAGE, "/ca/registry.pem"],
    {
      capture: true,
      env: { SIGNER: "1", REGISTRY: "1" },
      kubeconfig: "/kube/config",
    },
  );
});

test("the reference image is signed again even when the body throws, and the body's error is what surfaces", async () => {
  const { runner, run } = fakeRunner();

  await expect(
    withReferenceSigned(repository, runner, IMAGE, async () => {
      throw new Error("old key still admitted");
    }),
  ).rejects.toThrow("old key still admitted");

  expect(run).toHaveBeenCalledTimes(1);
});

test("the image is not signed before the body has run", async () => {
  const { runner, run } = fakeRunner();

  await withReferenceSigned(repository, runner, IMAGE, async () => {
    expect(run).not.toHaveBeenCalled();
  });
});

test("the body's result is returned after the image is signed again", async () => {
  const { runner } = fakeRunner();

  expect(
    await withReferenceSigned(repository, runner, IMAGE, async () => 7),
  ).toBe(7);
});
