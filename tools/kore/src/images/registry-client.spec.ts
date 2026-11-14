import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { registryHead } from "./registry-https.js";
import { withRegistryClient } from "./registry-client.js";
import type { RegistryCredential } from "./registry-auth.js";

// Docs: docs/decisions/0034-registry-authentication-and-authorization.md
// The real files, helper process and HTTPS request are integration concerns
// (integration/images/registry-client.spec.ts); here every one is a fake.

vi.mock("node:fs/promises", () => ({
  chmod: vi.fn(),
  mkdtemp: vi.fn(),
  rm: vi.fn(),
  writeFile: vi.fn(),
}));
vi.mock("node:os", () => ({ tmpdir: vi.fn() }));
vi.mock("node:path", () => ({
  delimiter: ":",
  join: vi.fn(),
}));
vi.mock("./registry-https.js", () => ({ registryHead: vi.fn() }));

const credential: RegistryCredential = {
  username: "kore-push",
  password: "s3cret-Pass_word-0123",
};
const ca = "-----BEGIN CERTIFICATE-----\nQUJD\n-----END CERTIFICATE-----\n";
const directory = "/tmp/kore-registry-1";

/** Fakes the file, path and temporary-directory calls so the directory is `directory`. */
function setUp(): void {
  vi.mocked(tmpdir).mockReturnValue("/tmp");
  vi.mocked(mkdtemp).mockResolvedValue(directory);
  vi.mocked(join).mockImplementation((...parts: string[]) => parts.join("/"));
  vi.mocked(writeFile).mockResolvedValue(undefined);
  vi.mocked(chmod).mockResolvedValue(undefined);
  vi.mocked(rm).mockResolvedValue(undefined);
}

/** The writeFile call that wrote `name` inside the temporary directory. */
function writtenTo(name: string) {
  const call = vi
    .mocked(writeFile)
    .mock.calls.find(([path]) => path === `${directory}/${name}`);
  if (call === undefined) {
    throw new Error(`no write to ${name}`);
  }
  return call;
}

describe("withRegistryClient: the temporary directory", () => {
  test("is made under the system temporary directory with the kore-registry prefix", async () => {
    setUp();
    await withRegistryClient(credential, ca, async () => undefined);
    expect(mkdtemp).toHaveBeenCalledWith("/tmp/kore-registry-");
  });

  test("is removed recursively and forcibly after the action returns its value", async () => {
    setUp();
    const value = await withRegistryClient(
      credential,
      ca,
      async () => "signed",
    );
    expect(value).toBe("signed");
    expect(rm).toHaveBeenCalledWith(directory, {
      force: true,
      recursive: true,
    });
  });

  test("is removed even when the action fails, and the failure is rethrown unchanged", async () => {
    setUp();
    await expect(
      withRegistryClient(credential, ca, async () => {
        throw new Error("sign failed");
      }),
    ).rejects.toThrow("sign failed");
    expect(rm).toHaveBeenCalledWith(directory, {
      force: true,
      recursive: true,
    });
  });
});

describe("withRegistryClient: the files it writes", () => {
  test("the Docker config names the kore-env credential store and is private", async () => {
    setUp();
    await withRegistryClient(credential, ca, async () => undefined);
    expect(writtenTo("config.json")).toEqual([
      `${directory}/config.json`,
      JSON.stringify({ credsStore: "kore-env" }),
      { mode: 0o600 },
    ]);
  });

  test("the CA is written as the public certificate only and is private", async () => {
    setUp();
    await withRegistryClient(credential, ca, async () => undefined);
    expect(writtenTo("ca.crt")).toEqual([
      `${directory}/ca.crt`,
      ca,
      { mode: 0o600 },
    ]);
  });

  test("the helper is written executable and chmodded 0700, and it only answers get", async () => {
    setUp();
    await withRegistryClient(credential, ca, async () => undefined);
    const [, script, options] = writtenTo("docker-credential-kore-env");
    expect(options).toEqual({ mode: 0o700 });
    expect(script).toMatch(/^#!\/bin\/sh\n/);
    expect(script).toContain('if [ "$1" != "get" ]; then');
    expect(script).toContain("only supports get");
    expect(chmod).toHaveBeenCalledWith(
      `${directory}/docker-credential-kore-env`,
      0o700,
    );
  });

  test("the helper's script holds no password, only the environment variable names", async () => {
    setUp();
    await withRegistryClient(credential, ca, async () => undefined);
    const [, script] = writtenTo("docker-credential-kore-env");
    expect(script).toContain("$KORE_REGISTRY_USERNAME");
    expect(script).toContain("$KORE_REGISTRY_PASSWORD");
    expect(script).not.toContain(credential.password);
  });
});

describe("withRegistryClient: what the action receives", () => {
  test("the environment points DOCKER_CONFIG at the directory and carries the credential", async () => {
    setUp();
    let env: NodeJS.ProcessEnv = {};
    await withRegistryClient(credential, ca, async (client) => {
      env = client.env;
    });
    expect(env).toMatchObject({
      DOCKER_CONFIG: directory,
      KORE_REGISTRY_USERNAME: credential.username,
      KORE_REGISTRY_PASSWORD: credential.password,
    });
  });

  test("the directory is first on PATH so the helper resolves before any other", async () => {
    setUp();
    let path = "";
    await withRegistryClient(credential, ca, async (client) => {
      path = client.env["PATH"] ?? "";
    });
    expect(path.startsWith(`${directory}:`)).toBe(true);
  });

  test("the Authorization header is Basic over the username and password", async () => {
    setUp();
    let header = "";
    await withRegistryClient(credential, ca, async (client) => {
      header = client.authorization;
    });
    expect(header).toBe(
      `Basic ${Buffer.from(`${credential.username}:${credential.password}`).toString("base64")}`,
    );
  });

  test("caFile is the ca.crt inside the directory", async () => {
    setUp();
    let caFile = "";
    await withRegistryClient(credential, ca, async (client) => {
      caFile = client.caFile;
    });
    expect(caFile).toBe(`${directory}/ca.crt`);
  });

  test("head sends the request verified against the registry CA", async () => {
    setUp();
    const answer = { status: 200, digest: "sha256:abc" };
    vi.mocked(registryHead).mockResolvedValue(answer as never);
    let result: unknown;
    await withRegistryClient(credential, ca, async (client) => {
      result = await client.head("https://registry/v2/x", { accept: "a" });
    });
    expect(registryHead).toHaveBeenCalledWith(
      "https://registry/v2/x",
      { accept: "a" },
      ca,
    );
    expect(result).toBe(answer);
  });
});
