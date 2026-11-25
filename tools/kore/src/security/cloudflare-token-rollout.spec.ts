// Docs: docs/decisions/0162-external-dns-publishes-route-records-for-the-external-gateway-behind-external-dns.md, docs/decisions/0163-one-cloudflare-zone-holds-the-platform-domain-opentofu-owns-fixed-records-and-external-dns-owns-route-records.md
import { readFile } from "node:fs/promises";
import { beforeEach, expect, test, vi } from "vitest";
import { featureEnabled, isLocalProvider } from "../config/index.js";
import { withSecretsRedacted } from "../images/index.js";
import type { Runner, RunResult } from "../runtime/index.js";
import type { Run } from "./security-support.js";
import { fakeRepository } from "./security-support.js";
import { applyCloudflareTokens } from "./cloudflare-token.js";

vi.mock("node:fs/promises");
vi.mock("../config/index.js", () => ({
  featureEnabled: vi.fn(),
  isLocalProvider: vi.fn(),
}));
vi.mock("../images/index.js", () => ({
  withSecretsRedacted: vi.fn(async (_secrets, operation) => await operation()),
}));

const externalDocument =
  "/repo/infra/environments/vps/secrets/cloudflare-external-dns.enc.yaml";
const acmeDocument =
  "/repo/infra/environments/vps/secrets/cloudflare-acme-dns01.enc.yaml";
// sha256 of the encrypted bytes each test reads for the document.
const externalChecksum =
  "4541f1c75fd2dd20fbeda0815351f473c1b88c653f99e36b3fcc0a949e2d6c69";
const acmeChecksum =
  "7bb685bdc2d5620df2ad8efe40c627f00838bcec81a78d062d4747110033e154";
const externalToken = "test-token-external-dns";

/** The live cluster a read answers from: the token Secret and the external-dns Deployment. */
interface Cluster {
  /** The live token Secret, absent until the first apply; `checksum` is its annotation, absent when it has none. */
  secret?: { checksum?: string };
  deployment?: boolean;
  restartFails?: boolean;
}

type Calls = ReturnType<typeof vi.fn<Run>>;

/** The decrypted document sops prints as JSON for a token Secret in a namespace. */
function decrypted(namespace: string, token: string) {
  return JSON.stringify({
    kind: "Secret",
    metadata: { name: "cloudflare-token", namespace },
    stringData: { "api-token": token },
  });
}

/** What a kubectl read returns: the Secret's annotations, the Deployment's name, or nothing when absent. */
function liveRead(args: readonly string[], cluster: Cluster): string {
  if (args.includes("secret")) {
    if (cluster.secret === undefined) {
      return "";
    }
    const { checksum } = cluster.secret;
    const annotations =
      checksum === undefined
        ? {}
        : { "platform.kore.dev/document-sha256": checksum };
    return JSON.stringify({ metadata: { annotations } });
  }
  if (args.includes("deployment/external-dns")) {
    return cluster.deployment ? "deployment.apps/external-dns\n" : "";
  }
  return "";
}

/**
 * A runner that answers sops from a table keyed by document path, answers
 * kubectl reads from the live `cluster`, and lets every other kubectl call succeed.
 */
function runnerWith(documents: Record<string, string>, cluster: Cluster = {}) {
  const run = vi.fn<Run>(async (command, args): Promise<RunResult> => {
    if (command === "sops") {
      return {
        stdout: documents[args.at(-1) ?? ""] ?? "",
        stderr: "",
        code: 0,
      };
    }
    if (args.includes("rollout") && cluster.restartFails) {
      throw new Error("the connection to the server was refused");
    }
    return { stdout: liveRead(args, cluster), stderr: "", code: 0 };
  });
  return { runner: { run } as Runner, run };
}

/** The arguments of each kubectl call that rolls a Deployment, in call order. */
function restarts(run: Calls) {
  return run.mock.calls.flatMap(([command, args]) =>
    command === "kubectl" && args.includes("rollout") ? [args] : [],
  );
}

/** Each call as apply, restart, or read, in call order. */
function steps(run: Calls) {
  return run.mock.calls.map(([, args]) => {
    if (args.includes("rollout")) {
      return "restart";
    }
    return args.includes("apply") ? "apply" : "read";
  });
}

/** The arguments that roll the external-dns Deployment in the configured context. */
const externalDnsRestart = [
  "--context",
  "kore-vps",
  "--namespace",
  "kore-external-dns",
  "rollout",
  "restart",
  "deployment/external-dns",
];

const vps = (features: Record<string, boolean>) =>
  fakeRepository({
    name: "vps",
    provider: "managed",
    kubeContext: "kore-vps",
    features,
  });

beforeEach(() => {
  vi.resetAllMocks();
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

test("a replaced external-dns document applies its Secret, then restarts the external-dns Deployment once", async () => {
  vi.mocked(readFile).mockResolvedValue(Buffer.from("ciphertext-external"));
  const { runner, run } = runnerWith(
    { [externalDocument]: decrypted("kore-external-dns", externalToken) },
    { secret: { checksum: "the-previous-document" }, deployment: true },
  );

  await applyCloudflareTokens(vps({ "external-dns": true }), runner);

  expect(restarts(run)).toEqual([externalDnsRestart]);
  expect(steps(run).filter((step) => step !== "read")).toEqual([
    "apply",
    "restart",
  ]);
});

test("every kubectl call names the configured context, the restart included, never the current one", async () => {
  vi.mocked(readFile).mockResolvedValue(Buffer.from("ciphertext-external"));
  const { runner, run } = runnerWith(
    { [externalDocument]: decrypted("kore-external-dns", externalToken) },
    { secret: { checksum: "the-previous-document" }, deployment: true },
  );

  await applyCloudflareTokens(vps({ "external-dns": true }), runner);

  const contexts = run.mock.calls
    .filter(([command]) => command === "kubectl")
    .map(([, args]) => args[args.indexOf("--context") + 1]);
  expect(contexts).toHaveLength(4);
  expect(new Set(contexts)).toEqual(new Set(["kore-vps"]));
});

test("an unchanged external-dns document applies again and restarts nothing, so rerunning kore secrets tokens is idempotent", async () => {
  vi.mocked(readFile).mockResolvedValue(Buffer.from("ciphertext-external"));
  const { runner, run } = runnerWith(
    { [externalDocument]: decrypted("kore-external-dns", externalToken) },
    { secret: { checksum: externalChecksum }, deployment: true },
  );

  await applyCloudflareTokens(vps({ "external-dns": true }), runner);

  expect(restarts(run)).toEqual([]);
  expect(steps(run).filter((step) => step === "apply")).toHaveLength(1);
});

test("a first apply, with no Secret and no external-dns Deployment yet, applies the Secret and restarts nothing", async () => {
  vi.mocked(readFile).mockResolvedValue(Buffer.from("ciphertext-external"));
  const { runner, run } = runnerWith(
    { [externalDocument]: decrypted("kore-external-dns", externalToken) },
    { deployment: false },
  );

  await applyCloudflareTokens(vps({ "external-dns": true }), runner);

  expect(restarts(run)).toEqual([]);
  expect(steps(run).filter((step) => step === "apply")).toHaveLength(1);
});

test("a replaced external-dns document restarts nothing while no external-dns Deployment exists", async () => {
  vi.mocked(readFile).mockResolvedValue(Buffer.from("ciphertext-external"));
  const { runner, run } = runnerWith(
    { [externalDocument]: decrypted("kore-external-dns", externalToken) },
    { secret: { checksum: "the-previous-document" }, deployment: false },
  );

  await applyCloudflareTokens(vps({ "external-dns": true }), runner);

  expect(restarts(run)).toEqual([]);
  expect(steps(run).filter((step) => step === "apply")).toHaveLength(1);
});

test("a replaced acme-dns01 document restarts nothing, because cert-manager reads its token at challenge time", async () => {
  vi.mocked(readFile).mockImplementation(async (path) =>
    Buffer.from(
      path === externalDocument ? "ciphertext-external" : "ciphertext-acme",
    ),
  );
  const { runner, run } = runnerWith(
    {
      [externalDocument]: decrypted("kore-external-dns", externalToken),
      [acmeDocument]: decrypted("cert-manager", "test-token-cert-manager"),
    },
    { secret: { checksum: externalChecksum }, deployment: true },
  );

  await applyCloudflareTokens(
    vps({ "external-dns": true, "acme-dns01": true }),
    runner,
  );

  expect(acmeChecksum).not.toEqual(externalChecksum);
  expect(restarts(run)).toEqual([]);
  expect(steps(run).filter((step) => step === "apply")).toHaveLength(2);
});

test("with the external-dns flag off nothing is restarted, even when the acme-dns01 document changed", async () => {
  vi.mocked(readFile).mockResolvedValue(Buffer.from("ciphertext-acme"));
  const { runner, run } = runnerWith(
    { [acmeDocument]: decrypted("cert-manager", "test-token-cert-manager") },
    { secret: { checksum: "the-previous-document" }, deployment: true },
  );

  await applyCloudflareTokens(vps({ "acme-dns01": true }), runner);

  expect(restarts(run)).toEqual([]);
  expect(steps(run).filter((step) => step === "apply")).toHaveLength(1);
});

test("a restart that fails after the Secret applied names the rollout command to run by hand, since a rerun would not retry it", async () => {
  vi.mocked(readFile).mockResolvedValue(Buffer.from("ciphertext-external"));
  const { runner } = runnerWith(
    { [externalDocument]: decrypted("kore-external-dns", externalToken) },
    {
      secret: { checksum: "the-previous-document" },
      deployment: true,
      restartFails: true,
    },
  );

  await expect(
    applyCloudflareTokens(vps({ "external-dns": true }), runner),
  ).rejects.toThrow(
    "kubectl --context kore-vps --namespace kore-external-dns rollout restart deployment/external-dns",
  );
});
