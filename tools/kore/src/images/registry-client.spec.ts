import { execFileSync } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { withRegistryClient } from "./registry-client.js";

const caPem = "-----BEGIN CERTIFICATE-----\nQUJD\n-----END CERTIFICATE-----\n";
const credential = { username: "kore-push", password: "s3cret-Pass_word-0123" };

test("the credential reaches the client only through its environment, never a file", async () => {
  let files: Record<string, string> = {};
  let env: NodeJS.ProcessEnv = {};
  let directory = "";
  await withRegistryClient(credential, caPem, async (client) => {
    env = client.env;
    directory = client.env["DOCKER_CONFIG"] ?? "";
    for (const name of await readdir(directory)) {
      files[name] = await readFile(join(directory, name), "utf8");
    }
  });

  expect(env["KORE_REGISTRY_PASSWORD"]).toBe(credential.password);
  expect(Object.keys(files).length).toBeGreaterThan(0);
  for (const content of Object.values(files)) {
    expect(content).not.toContain(credential.password);
  }
  expect(JSON.parse(files["config.json"] ?? "{}")).toEqual({
    credsStore: "kore-env",
  });
});

test("the helper directory is deleted after the call, even when it fails", async () => {
  let directory = "";
  await expect(
    withRegistryClient(credential, caPem, async (client) => {
      directory = client.env["DOCKER_CONFIG"] ?? "";
      throw new Error("sign failed");
    }),
  ).rejects.toThrow("sign failed");

  await expect(stat(directory)).rejects.toThrow(/ENOENT/);
});

test("the credential helper answers a get request with the environment's identity", async () => {
  await withRegistryClient(credential, caPem, async (client) => {
    const helper = join(
      client.env["DOCKER_CONFIG"] ?? "",
      "docker-credential-kore-env",
    );
    const out = execFileSync(helper, ["get"], {
      input: "127.0.0.1:30500",
      env: client.env,
    }).toString();
    expect(JSON.parse(out)).toEqual({
      ServerURL: "127.0.0.1:30500",
      Username: credential.username,
      Secret: credential.password,
    });
    expect(client.env["PATH"]?.split(":")[0]).toBe(client.env["DOCKER_CONFIG"]);
  });
});

test("the helper refuses every action except get so it can never store or erase", async () => {
  await withRegistryClient(credential, caPem, async (client) => {
    const helper = join(
      client.env["DOCKER_CONFIG"] ?? "",
      "docker-credential-kore-env",
    );
    expect(() =>
      execFileSync(helper, ["store"], { input: "{}", env: client.env }),
    ).toThrow();
  });
});

test("the Authorization header carries the credential for in-process lookups", async () => {
  await withRegistryClient(credential, caPem, async (client) => {
    expect(client.authorization).toBe(
      `Basic ${Buffer.from(`${credential.username}:${credential.password}`).toString("base64")}`,
    );
  });
});

test("the CA reaches cosign as a temporary file that holds only the public certificate and is removed afterwards", async () => {
  let caFile = "";
  await withRegistryClient(credential, caPem, async (client) => {
    caFile = client.caFile;
    expect(await readFile(caFile, "utf8")).toBe(caPem);
  });
  await expect(stat(caFile)).rejects.toThrow(/ENOENT/);
});
