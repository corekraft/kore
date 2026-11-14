// Docs: docs/decisions/0059-identity-policy-evidence.md
import { beforeEach, expect, test, vi } from "vitest";
import { isLocalProvider, trustedSigners } from "../config/index.js";
import {
  koreManagesRegistryAuth,
  loadRegistryCa,
  loadRegistryCredential,
  localRegistryReference,
  withRegistryClient,
  type RegistryClient,
  type RegistryCredential,
} from "../images/index.js";
import { environmentStatePath } from "../runtime/index.js";
import { fakeImage, fakeRepository, fakeRunner } from "./app-support.js";
import {
  assertTrustedSigner,
  localPublicKeyPath,
  verifyImage,
  verifyLockedImageArgs,
} from "./verify.js";

vi.mock("../config/index.js");
vi.mock("../images/index.js");
vi.mock("../runtime/index.js");

const localKey = "local-kore-key";
const releaseSigner = "release@kore.dev";
const keyless = [
  "--certificate-identity",
  releaseSigner,
  "--certificate-oidc-issuer",
  "https://token.actions.githubusercontent.com",
];
const credential = { username: "kore-read" } as RegistryCredential;
const client = {
  caFile: "/tmp/kore-registry/ca.crt",
  env: { KORE_REGISTRY_USERNAME: "kore-read" },
} as unknown as RegistryClient;

/** Runs the action with the fake client, as the real client does with its scratch files. */
function withFakeClient(): void {
  vi.mocked(withRegistryClient).mockImplementation(
    async (_credential, _ca, action) => action(client),
  );
}

beforeEach(() => {
  vi.mocked(isLocalProvider).mockReturnValue(true);
  vi.mocked(trustedSigners).mockReturnValue([localKey, releaseSigner]);
  vi.mocked(koreManagesRegistryAuth).mockReturnValue(false);
  vi.mocked(localRegistryReference).mockImplementation(
    async (_repository, _runner, reference) => reference,
  );
  vi.mocked(environmentStatePath).mockImplementation(
    (root, environment, file) => `${root}/.kore/state/${environment}/${file}`,
  );
});

test("keyless verification is bound to the locked signer identity and issuer, never a key", () => {
  expect(verifyLockedImageArgs(fakeImage(releaseSigner))).toEqual([
    "verify",
    ...keyless,
    fakeImage(releaseSigner).reference,
  ]);
});

test("a key-verified image trusts the given key and skips the transparency log, never an identity", () => {
  const args = verifyLockedImageArgs(fakeImage(localKey), "/k.pub");
  expect(args).toEqual([
    "verify",
    "--insecure-ignore-tlog",
    "--key",
    "/k.pub",
    fakeImage(localKey).reference,
  ]);
  expect(args).not.toContain("--certificate-identity");
});

test("a registry verified over TLS passes its CA file, and an empty CA path adds nothing", () => {
  expect(
    verifyLockedImageArgs(fakeImage(), undefined, "/tmp/ca.crt").slice(0, 3),
  ).toEqual(["verify", "--registry-cacert", "/tmp/ca.crt"]);
  expect(verifyLockedImageArgs(fakeImage())).not.toContain("--registry-cacert");
});

test("the local public key is the environment's published signing key, never the legacy key directory", () => {
  expect(localPublicKeyPath("/workspace", "local")).toBe(
    "/workspace/.kore/state/local/local-signing.pub",
  );
  expect(environmentStatePath).toHaveBeenCalledWith(
    "/workspace",
    "local",
    "local-signing.pub",
  );
});

test("a signer the environment's image policy does not list is refused, naming the signer and the environment", () => {
  vi.mocked(trustedSigners).mockReturnValue([releaseSigner]);
  expect(() =>
    assertTrustedSigner(fakeRepository(), fakeImage(localKey)),
  ).toThrow(
    /image signer local-kore-key is not trusted by environment local.*Rebuild or relock/s,
  );
});

test("a listed signer passes the trust check", () => {
  expect(() =>
    assertTrustedSigner(fakeRepository(), fakeImage(releaseSigner)),
  ).not.toThrow();
  expect(trustedSigners).toHaveBeenCalledWith(expect.anything());
});

test("an untrusted signer is refused before any registry lookup or cosign call", async () => {
  vi.mocked(trustedSigners).mockReturnValue([releaseSigner]);
  const { runner, run } = fakeRunner();
  await expect(
    verifyImage(fakeRepository(), runner, fakeImage(localKey)),
  ).rejects.toThrow(/not trusted by environment/);
  expect(localRegistryReference).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});

test("a managed environment verifies a release image keylessly and loads no registry credential", async () => {
  vi.mocked(isLocalProvider).mockReturnValue(false);
  const { runner, run } = fakeRunner();
  await verifyImage(
    fakeRepository({ provider: "managed" }),
    runner,
    fakeImage(releaseSigner),
  );
  expect(run).toHaveBeenCalledWith(
    "cosign",
    verifyLockedImageArgs({
      ...fakeImage(releaseSigner),
      reference: fakeImage(releaseSigner).reference,
    }),
    { capture: false },
  );
  expect(loadRegistryCredential).not.toHaveBeenCalled();
  expect(withRegistryClient).not.toHaveBeenCalled();
});

test("cosign verifies the registry-resolved reference, not the cluster-local name in the lock", async () => {
  vi.mocked(isLocalProvider).mockReturnValue(false);
  vi.mocked(localRegistryReference).mockResolvedValue(
    "127.0.0.1:30500/reference@sha256:" + "a".repeat(64),
  );
  const { runner, run } = fakeRunner();
  await verifyImage(
    fakeRepository({ provider: "managed" }),
    runner,
    fakeImage(releaseSigner),
  );
  expect(localRegistryReference).toHaveBeenCalledWith(
    expect.anything(),
    runner,
    fakeImage(releaseSigner).reference,
  );
  expect(run.mock.calls[0]?.[1]).toContain(
    "127.0.0.1:30500/reference@sha256:" + "a".repeat(64),
  );
});

test("a local source build is verified with the generated key and the read-only identity, through a scratch client", async () => {
  vi.mocked(koreManagesRegistryAuth).mockReturnValue(true);
  vi.mocked(loadRegistryCredential).mockResolvedValue(credential);
  vi.mocked(loadRegistryCa).mockResolvedValue("CA-PEM");
  withFakeClient();
  const { runner, run } = fakeRunner();

  await verifyImage(fakeRepository(), runner, fakeImage(localKey));

  expect(loadRegistryCredential).toHaveBeenCalledWith(
    expect.anything(),
    runner,
    "read",
  );
  expect(withRegistryClient).toHaveBeenCalledWith(
    credential,
    "CA-PEM",
    expect.any(Function),
  );
  expect(run).toHaveBeenCalledWith(
    "cosign",
    expect.arrayContaining([
      "--registry-cacert",
      client.caFile,
      "--key",
      "/repo/.kore/state/local/local-signing.pub",
    ]),
    { capture: false, env: expect.objectContaining(client.env) },
  );
});

test("an explicit public key overrides the generated one for a local source build", async () => {
  vi.mocked(koreManagesRegistryAuth).mockReturnValue(false);
  const { runner, run } = fakeRunner();
  await verifyImage(
    fakeRepository(),
    runner,
    fakeImage(localKey),
    "/given.pub",
  );
  expect(run.mock.calls[0]?.[1]).toEqual(
    expect.arrayContaining(["--key", "/given.pub"]),
  );
});

test("a local verification loads only the read-only registry credential, never the push one", async () => {
  vi.mocked(koreManagesRegistryAuth).mockReturnValue(true);
  vi.mocked(loadRegistryCredential).mockResolvedValue(credential);
  vi.mocked(loadRegistryCa).mockResolvedValue("CA-PEM");
  withFakeClient();
  const { runner } = fakeRunner();
  await verifyImage(fakeRepository(), runner, fakeImage(localKey));
  expect(vi.mocked(loadRegistryCredential).mock.calls).toEqual([
    [expect.anything(), runner, "read"],
  ]);
});
