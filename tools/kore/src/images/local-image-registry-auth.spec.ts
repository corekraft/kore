import { loadRepository } from "../config/index.js";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { type Repository } from "../config/index.js";
import {
  encodeBase64,
  entry,
  fakeRunner,
  pushPassword,
  stubRegistry,
} from "./local-image-fixtures.js";
import { buildAndSignLocalImage } from "./local-image.js";

const registryReference = vi.hoisted(() => vi.fn());
vi.mock("./registry.js", () => ({ localRegistryReference: registryReference }));
const registryHead = vi.hoisted(() => vi.fn());
vi.mock("./registry-https.js", () => ({ registryHead }));

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  registryReference.mockReset();
  registryHead.mockReset();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

async function testRepository(): Promise<Repository> {
  const root = await mkdtemp(join(tmpdir(), "kore-local-image-"));
  roots.push(root);
  return { ...(await loadRepository("local")), root };
}

test("the push credential reaches the node only on stdin and never in an argument", async () => {
  const repository = await testRepository();
  const { runner, calls } = fakeRunner();
  stubRegistry(registryReference, registryHead);

  await buildAndSignLocalImage(repository, runner, "reference", entry);

  const publish = calls.find((c) => c.args.some((a) => a.includes("push")))!;
  const basic = encodeBase64(`kore-push:${pushPassword}`);
  expect(publish.options?.input).toBe(`${basic}\n`);
  const everyArgument = JSON.stringify(calls.map((c) => c.args));
  expect(everyArgument).not.toContain(pushPassword);
  expect(everyArgument).not.toContain(basic);
});

test("the node keeps its login in memory-backed storage and removes it afterwards", async () => {
  const repository = await testRepository();
  const { runner, calls } = fakeRunner();
  stubRegistry(registryReference, registryHead);

  await buildAndSignLocalImage(repository, runner, "reference", entry);

  const script = calls
    .find((c) => c.args.some((a) => a.includes("push")))!
    .args.join(" ");
  expect(script).toContain("/dev/shm");
  expect(script).toMatch(/trap .*rm -rf/);
});

test("cosign signs with the push credential through a helper whose files hold no secret", async () => {
  const repository = await testRepository();
  const { runner, calls } = fakeRunner();
  stubRegistry(registryReference, registryHead);

  await buildAndSignLocalImage(repository, runner, "reference", entry);

  const sign = calls.find(({ args }) => args[0] === "sign")!;
  expect(sign.options?.env?.KORE_REGISTRY_USERNAME).toBe("kore-push");
  expect(sign.options?.env?.KORE_REGISTRY_PASSWORD).toBe(pushPassword);
  expect(sign.options?.kubeconfig).toBeTruthy();
  expect(sign.options?.env?.KUBECONFIG).toBeUndefined();
  expect(JSON.stringify(sign.args)).not.toContain(pushPassword);
  await expect(stat(sign.options?.env?.DOCKER_CONFIG ?? "")).rejects.toThrow(
    /ENOENT/,
  );
});

test("the digest lookup authenticates and a rejected credential is reported actionably", async () => {
  const repository = await testRepository();
  const { runner } = fakeRunner();
  registryHead.mockResolvedValue({ status: 401, digest: "" });
  registryReference.mockImplementation(
    async (_repo, _runner, reference) => reference,
  );

  await expect(
    buildAndSignLocalImage(repository, runner, "reference", entry),
  ).rejects.toThrow(/HTTP 401/);
  const [url, headers, ca] = registryHead.mock.calls[0] as [
    string,
    Record<string, string>,
    string,
  ];
  expect(url).toMatch(/^https:\/\/127\.0\.0\.1:30500\//);
  expect(ca).toContain("BEGIN CERTIFICATE");
  expect(headers["Authorization"]).toBe(
    `Basic ${encodeBase64(`kore-push:${pushPassword}`)}`,
  );
});

test("the node reads exactly one credential line, so the publish never waits for end of input", async () => {
  const repository = await testRepository();
  const { runner, calls } = fakeRunner();
  stubRegistry(registryReference, registryHead);

  await buildAndSignLocalImage(repository, runner, "reference", entry);

  const script = calls
    .find((c) => c.args.some((a) => a.includes("push")))!
    .args.join(" ");
  expect(script).toMatch(/IFS= read -r \w+/);
});

test("credentialed node sessions go through docker exec on the node, never a node shell", async () => {
  const repository = await testRepository();
  const { runner, calls } = fakeRunner();
  stubRegistry(registryReference, registryHead);

  await buildAndSignLocalImage(repository, runner, "reference", entry);

  const publish = calls.find((c) => c.args.some((a) => a.includes("push")))!;
  expect(publish.command).toBe("docker");
  expect(publish.args[0]).toBe("exec");
  const commands = calls.map(({ command }) => command);
  expect(commands).not.toContain("ssh");
});

test("a failed publish never carries the push password in its error, even if the node echoed it", async () => {
  const repository = await testRepository();
  const { runner } = fakeRunner();
  stubRegistry(registryReference, registryHead);
  const echoing: typeof runner = {
    async run(command, args, options) {
      if (args.some((a) => a.includes("push"))) {
        throw new Error(
          `docker exec failed (1): ${pushPassword}\n${pushPassword}`,
        );
      }
      return runner.run(command, args, options);
    },
  };

  const error = await buildAndSignLocalImage(
    repository,
    echoing,
    "reference",
    entry,
  ).catch((e: unknown) => e as Error);

  if (!(error instanceof Error)) {
    throw new Error("the failed publish must reject");
  }
  expect(error.message).not.toContain(pushPassword);
  expect(String(error.stack)).not.toContain(pushPassword);
  expect(error.message).toContain("[REDACTED]");
});
