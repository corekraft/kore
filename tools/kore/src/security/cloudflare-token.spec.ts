// Docs: docs/decisions/0161-cert-manager-solves-dns-01-through-cloudflare-and-issues-per-suborg-wildcards-behind-acme-dns01.md, docs/decisions/0162-external-dns-publishes-route-records-for-the-external-gateway-behind-external-dns.md, docs/decisions/0163-one-cloudflare-zone-holds-the-platform-domain-opentofu-owns-fixed-records-and-external-dns-owns-route-records.md
import { readFile } from "node:fs/promises";
import { beforeEach, expect, test, vi } from "vitest";
import { isLocalProvider, featureEnabled } from "../config/index.js";
import { withSecretsRedacted } from "../images/index.js";
import type { Runner, RunResult } from "../runtime/index.js";
import type { Run } from "./security-support.js";
import { errno, fakeRepository } from "./security-support.js";
import { rollsDeployment } from "./token-rollout.js";
import {
  activeTokenConsumers,
  applyCloudflareTokens,
  tokenConsumers,
} from "./cloudflare-token.js";

vi.mock("node:fs/promises");
vi.mock("../config/index.js", () => ({
  featureEnabled: vi.fn(),
  isLocalProvider: vi.fn(),
}));
vi.mock("../images/index.js", () => ({
  withSecretsRedacted: vi.fn(async (_secrets, operation) => await operation()),
}));
vi.mock("./token-rollout.js", () => ({
  rollsDeployment: vi.fn(),
  rollDeployment: vi.fn(),
}));

const externalDocument =
  "/repo/infra/environments/vps/secrets/cloudflare-external-dns.enc.yaml";
const acmeDocument =
  "/repo/infra/environments/vps/secrets/cloudflare-acme-dns01.enc.yaml";
const externalToken = "test-token-external-dns";
const acmeToken = "test-token-cert-manager";
// sha256 of the encrypted document's bytes: the checksum the Secret carries.
const externalChecksum =
  "4541f1c75fd2dd20fbeda0815351f473c1b88c653f99e36b3fcc0a949e2d6c69";
const acmeChecksum =
  "7bb685bdc2d5620df2ad8efe40c627f00838bcec81a78d062d4747110033e154";

/** The decrypted document sops prints as JSON for a token Secret in a namespace. */
function decrypted(namespace: string, token: string, key = "api-token") {
  return JSON.stringify({
    apiVersion: "v1",
    kind: "Secret",
    metadata: { name: "cloudflare-token", namespace },
    type: "Opaque",
    stringData: { [key]: token },
  });
}

/**
 * A runner whose sops decrypt answers from a table keyed by document path, and
 * whose kubectl calls succeed. A table entry that is an Error makes sops fail.
 */
function runnerWith(documents: Record<string, string | Error>) {
  const run = vi.fn<Run>(async (command, args): Promise<RunResult> => {
    if (command === "sops") {
      const answer = documents[args.at(-1) ?? ""];
      if (answer === undefined || answer instanceof Error) {
        throw answer ?? new Error("no such document");
      }
      return { stdout: answer, stderr: "", code: 0 };
    }
    return { stdout: "", stderr: "", code: 0 };
  });
  return { runner: { run } as Runner, run };
}

/** The Secrets kubectl was streamed, in call order, with their target namespace. */
function applied(run: ReturnType<typeof vi.fn<Run>>) {
  return run.mock.calls.flatMap(([command, args, options]) =>
    command === "kubectl" && options?.input?.startsWith("{")
      ? [
          {
            namespace: args[args.indexOf("--namespace") + 1],
            secret: JSON.parse(options.input),
          },
        ]
      : [],
  );
}

const vps = (features: Record<string, boolean>) =>
  fakeRepository({
    name: "vps",
    provider: "managed",
    kubeContext: "kore-vps",
    features,
  });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(rollsDeployment).mockResolvedValue(false);
  vi.mocked(withSecretsRedacted).mockImplementation(
    async (_secrets, operation) => await operation(),
  );
  vi.mocked(featureEnabled).mockImplementation(
    (environment, flag) =>
      (environment.features as Record<string, boolean> | undefined)?.[flag] ===
      true,
  );
  vi.mocked(isLocalProvider).mockImplementation(
    (environment) => environment.provider === "k3d",
  );
});

test("the external-dns token reaches kubectl only on stdin, in the configured context, and no argument carries its value", async () => {
  vi.mocked(readFile).mockResolvedValue(Buffer.from("ciphertext-external"));
  const { runner, run } = runnerWith({
    [externalDocument]: decrypted("kore-external-dns", externalToken),
  });

  await applyCloudflareTokens(vps({ "external-dns": true }), runner);

  expect(run.mock.calls[0]).toEqual([
    "sops",
    ["--decrypt", "--output-type", "json", externalDocument],
    { capture: true },
  ]);
  const [command, args, options] = run.mock.calls[1]!;
  expect([command, args]).toEqual([
    "kubectl",
    [
      "--context",
      "kore-vps",
      "--namespace",
      "kore-external-dns",
      "apply",
      "--server-side",
      "--field-manager=kore-tokens",
      "--filename=-",
    ],
  ]);
  expect(JSON.parse(options!.input!)).toEqual({
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name: "cloudflare-token",
      namespace: "kore-external-dns",
      annotations: { "platform.kore.dev/document-sha256": externalChecksum },
    },
    type: "Opaque",
    stringData: { "api-token": externalToken },
  });
  expect(JSON.stringify(args)).not.toContain(externalToken);
  expect(withSecretsRedacted).toHaveBeenCalledWith(
    [externalToken],
    expect.any(Function),
  );
});

test("each consumer gets its own Secret in its own namespace, from its own document", async () => {
  vi.mocked(readFile).mockImplementation(async (path) =>
    Buffer.from(
      path === externalDocument ? "ciphertext-external" : "ciphertext-acme",
    ),
  );
  const { runner, run } = runnerWith({
    [externalDocument]: decrypted("kore-external-dns", externalToken),
    [acmeDocument]: decrypted("cert-manager", acmeToken),
  });

  const result = await applyCloudflareTokens(
    vps({ "external-dns": true, "acme-dns01": true }),
    runner,
  );

  expect(
    applied(run).map(({ namespace, secret }) => [
      namespace,
      secret.metadata.namespace,
      secret.stringData["api-token"],
      secret.metadata.annotations["platform.kore.dev/document-sha256"],
    ]),
  ).toEqual([
    ["kore-external-dns", "kore-external-dns", externalToken, externalChecksum],
    ["cert-manager", "cert-manager", acmeToken, acmeChecksum],
  ]);
  expect(result).toEqual([
    { consumer: "external-dns", namespace: "kore-external-dns" },
    { consumer: "acme-dns01", namespace: "cert-manager" },
  ]);
});

test("a missing document is refused before any cluster call, even when the other document is fine", async () => {
  vi.mocked(readFile).mockImplementation(async (path) => {
    if (path === acmeDocument) {
      throw errno("ENOENT");
    }
    return Buffer.from("ciphertext-external");
  });
  const { runner, run } = runnerWith({
    [externalDocument]: decrypted("kore-external-dns", externalToken),
  });

  await expect(
    applyCloudflareTokens(
      vps({ "external-dns": true, "acme-dns01": true }),
      runner,
    ),
  ).rejects.toThrow(
    new Error(
      `no token document at ${acmeDocument}; create it with sops as a Secret named cloudflare-token in cert-manager with stringData.api-token, then rerun kore secrets tokens`,
    ),
  );
  expect(applied(run)).toEqual([]);
});

test("a document that does not decrypt is refused before any cluster call, naming the document and the fix", async () => {
  vi.mocked(readFile).mockResolvedValue(Buffer.from("ciphertext-external"));
  const { runner, run } = runnerWith({
    [externalDocument]: new Error(
      "sops: no identity matched any of the recipients",
    ),
  });

  await expect(
    applyCloudflareTokens(vps({ "external-dns": true }), runner),
  ).rejects.toThrow(
    new Error(
      `could not decrypt ${externalDocument}: sops: no identity matched any of the recipients; check that SOPS_AGE_KEY_FILE holds this environment's age identity and that .sops.yaml lists its recipient, then rerun kore secrets tokens`,
    ),
  );
  expect(applied(run)).toEqual([]);
});

test("a document that names another namespace is refused, so a token never lands where its consumer does not read", async () => {
  vi.mocked(readFile).mockResolvedValue(Buffer.from("ciphertext-external"));
  const { runner, run } = runnerWith({
    [externalDocument]: decrypted("cert-manager", externalToken),
  });

  await expect(
    applyCloudflareTokens(vps({ "external-dns": true }), runner),
  ).rejects.toThrow(
    new Error(
      `${externalDocument} names namespace cert-manager, but external-dns reads its token from kore-external-dns; set metadata.namespace to kore-external-dns with sops, then rerun kore secrets tokens`,
    ),
  );
  expect(applied(run)).toEqual([]);
});

test("a document without the api-token key is refused, and its other values are never echoed", async () => {
  vi.mocked(readFile).mockResolvedValue(Buffer.from("ciphertext-external"));
  const { runner, run } = runnerWith({
    [externalDocument]: decrypted("kore-external-dns", externalToken, "token"),
  });

  const failure = applyCloudflareTokens(vps({ "external-dns": true }), runner);

  await expect(failure).rejects.toThrow(
    new Error(
      `${externalDocument} has no stringData.api-token; set the Cloudflare token under that key with sops, then rerun kore secrets tokens`,
    ),
  );
  await expect(failure).rejects.not.toThrow(externalToken);
  expect(applied(run)).toEqual([]);
});

test("with both flags off nothing is read, decrypted or applied", async () => {
  const { runner, run } = runnerWith({});

  const result = await applyCloudflareTokens(vps({}), runner);

  expect(result).toEqual([]);
  expect(readFile).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});

test("a local environment applies nothing, because local external-dns runs with the inmemory provider and needs no token", async () => {
  const { runner, run } = runnerWith({});
  const local = fakeRepository({
    name: "local",
    provider: "k3d",
    features: { "external-dns": true, "acme-dns01": true },
  });

  expect(await applyCloudflareTokens(local, runner)).toEqual([]);
  expect(readFile).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});

test("an unchanged document applies the same Secret, and a replaced document changes the checksum the Secret carries", async () => {
  const { runner, run } = runnerWith({
    [externalDocument]: decrypted("kore-external-dns", externalToken),
  });
  const repository = vps({ "external-dns": true });

  vi.mocked(readFile).mockResolvedValue(Buffer.from("ciphertext-external"));
  await applyCloudflareTokens(repository, runner);
  vi.mocked(readFile).mockResolvedValue(Buffer.from("ciphertext-external"));
  await applyCloudflareTokens(repository, runner);
  const [first, second] = applied(run);
  expect(second!.secret).toEqual(first!.secret);

  vi.mocked(readFile).mockResolvedValue(Buffer.from("ciphertext-replaced"));
  await applyCloudflareTokens(repository, runner);
  const replaced = applied(run).at(-1)!;
  expect(replaced.secret.metadata.annotations).not.toEqual(
    first!.secret.metadata.annotations,
  );
});

test("the consumers are external-dns and acme-dns01, each behind its own flag, and only the flags that are on are active", () => {
  expect(
    tokenConsumers.map(({ name, flag, namespace, document }) => [
      name,
      flag,
      namespace,
      document,
    ]),
  ).toEqual([
    [
      "external-dns",
      "external-dns",
      "kore-external-dns",
      "cloudflare-external-dns.enc.yaml",
    ],
    [
      "acme-dns01",
      "acme-dns01",
      "cert-manager",
      "cloudflare-acme-dns01.enc.yaml",
    ],
  ]);
  expect(activeTokenConsumers(vps({}).environment)).toEqual([]);
  expect(
    activeTokenConsumers(vps({ "acme-dns01": true }).environment).map(
      ({ name }) => name,
    ),
  ).toEqual(["acme-dns01"]);
});
