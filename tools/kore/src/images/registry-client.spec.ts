// Docs: docs/decisions/0034-registry-authentication-and-authorization.md
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { withRegistryClient } from "./registry-client.js";
import { registryHead } from "./registry-https.js";

vi.mock("node:fs/promises");
vi.mock("node:os");
vi.mock("node:path");
vi.mock("./registry-https.js");

const directory = "/tmp/kore-registry-abc";
const ca = "-----BEGIN CERTIFICATE-----\nQUJD\n-----END CERTIFICATE-----\n";
const credential = { username: "kore-push", password: "s3cret-Pass_word" };
const helper = `${directory}/docker-credential-kore-env`;

beforeEach(() => {
  vi.stubEnv("PATH", "/usr/bin:/bin");
  vi.mocked(join).mockImplementation((...parts: string[]) => parts.join("/"));
  vi.mocked(tmpdir).mockReturnValue("/tmp");
  vi.mocked(mkdtemp).mockResolvedValue(directory);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

test("the child environment carries the credential and the helper directory, and the helper answers from it", async () => {
  const env = await withRegistryClient(credential, ca, async (client) => {
    return client.env;
  });

  expect(env).toEqual({
    DOCKER_CONFIG: directory,
    PATH: `${directory}:/usr/bin:/bin`,
    KORE_REGISTRY_USERNAME: "kore-push",
    KORE_REGISTRY_PASSWORD: "s3cret-Pass_word",
  });
});

test("the config and the CA are written mode 0600, and the credential is written to no file", async () => {
  await withRegistryClient(credential, ca, async () => undefined);

  expect(writeFile).toHaveBeenNthCalledWith(
    1,
    `${directory}/config.json`,
    JSON.stringify({ credsStore: "kore-env" }),
    { mode: 0o600 },
  );
  expect(writeFile).toHaveBeenNthCalledWith(2, `${directory}/ca.crt`, ca, {
    mode: 0o600,
  });
  for (const [, content] of vi.mocked(writeFile).mock.calls) {
    expect(String(content)).not.toContain(credential.password);
  }
});

test("the helper script is written and made executable, and only get is answered", async () => {
  await withRegistryClient(credential, ca, async () => undefined);

  const script = vi.mocked(writeFile).mock.calls[2]?.[1];
  expect(vi.mocked(writeFile).mock.calls[2]).toEqual([
    helper,
    script,
    { mode: 0o700 },
  ]);
  expect(String(script)).toMatch(/^#!\/bin\/sh\n/);
  expect(String(script)).toContain('if [ "$1" != "get" ]; then');
  expect(chmod).toHaveBeenCalledWith(helper, 0o700);
});

test("the CA reaches cosign as the temporary file, and head verifies against the same CA", async () => {
  vi.mocked(registryHead).mockResolvedValue({
    status: 200,
    digest: "sha256:d",
  });
  let caFile = "";
  let head: Awaited<ReturnType<typeof registryHead>> | undefined;

  await withRegistryClient(credential, ca, async (client) => {
    caFile = client.caFile;
    head = await client.head("https://x/v2/", { accept: "a" });
  });

  expect(caFile).toBe(`${directory}/ca.crt`);
  expect(registryHead).toHaveBeenCalledWith(
    "https://x/v2/",
    { accept: "a" },
    ca,
  );
  expect(head).toEqual({ status: 200, digest: "sha256:d" });
});

test("the Authorization header is the Basic encoding of the credential for in-process lookups", async () => {
  let authorization = "";
  await withRegistryClient(credential, ca, async (client) => {
    authorization = client.authorization;
  });

  expect(authorization).toBe(
    `Basic ${Buffer.from("kore-push:s3cret-Pass_word").toString("base64")}`,
  );
});

test("the private directory is removed when the action succeeds", async () => {
  await withRegistryClient(credential, ca, async () => "done");

  expect(rm).toHaveBeenCalledWith(directory, { force: true, recursive: true });
});

test("the private directory is removed even when the action fails, and the failure is rethrown", async () => {
  const failure = new Error("sign failed");

  await expect(
    withRegistryClient(credential, ca, async () => {
      throw failure;
    }),
  ).rejects.toBe(failure);

  expect(rm).toHaveBeenCalledWith(directory, { force: true, recursive: true });
});
