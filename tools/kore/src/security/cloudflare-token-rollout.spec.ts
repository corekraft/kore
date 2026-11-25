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
const documentKey = "platform.kore.dev/document-sha256";
const rolledKey = "platform.kore.dev/rolled-document-sha256";
// sha256 of the encrypted bytes each test reads for the document.
const externalChecksum =
  "4541f1c75fd2dd20fbeda0815351f473c1b88c653f99e36b3fcc0a949e2d6c69";
const acmeChecksum =
  "7bb685bdc2d5620df2ad8efe40c627f00838bcec81a78d062d4747110033e154";
// The checksum a Secret carries from an earlier apply, and the one it has rolled.
const previousChecksum = "the-previous-document";
const externalToken = "test-token-external-dns";

/**
 * The live cluster the kubectl calls read and change: the token Secret's
 * annotations, absent until the first apply, and whether the external-dns
 * Deployment exists. A restart that fails changes nothing.
 */
interface Cluster {
  secret?: Record<string, string>;
  deployment: boolean;
  restartFails: boolean;
}

/** A cluster whose token Secret was last applied and rolled at `checksum`. */
const rolledAt = (checksum: string, deployment = true): Cluster => ({
  secret: { [documentKey]: checksum, [rolledKey]: checksum },
  deployment,
  restartFails: false,
});

type Calls = ReturnType<typeof vi.fn<Run>>;

/** The decrypted document sops prints as JSON for a token Secret in a namespace. */
function decrypted(namespace: string, token: string) {
  return JSON.stringify({
    kind: "Secret",
    metadata: { name: "cloudflare-token", namespace },
    stringData: { "api-token": token },
  });
}

/** What a kubectl read returns: the Secret's annotations or the Deployment's name, or nothing when absent. */
function read(args: readonly string[], cluster: Cluster): string {
  if (args.includes("get") && args.includes("secret")) {
    return cluster.secret === undefined
      ? ""
      : JSON.stringify({ metadata: { annotations: cluster.secret } });
  }
  if (args.includes("get") && args.includes("deployment/external-dns")) {
    return cluster.deployment ? "deployment.apps/external-dns\n" : "";
  }
  return "";
}

/**
 * A runner that answers sops from a table keyed by document path, and answers
 * kubectl the way the cluster would: an apply sets the checksum it carries and
 * keeps the rolled record, a record sets the rolled record, and a restart fails
 * when the cluster says so.
 */
function runnerWith(documents: Record<string, string>, cluster: Cluster) {
  const run = vi.fn<Run>(async (command, args, options): Promise<RunResult> => {
    if (command === "sops") {
      return {
        stdout: documents[args.at(-1) ?? ""] ?? "",
        stderr: "",
        code: 0,
      };
    }
    if (args.includes("apply")) {
      const manifest: { metadata: { annotations: Record<string, string> } } =
        JSON.parse(options?.input ?? "{}");
      cluster.secret = { ...cluster.secret, ...manifest.metadata.annotations };
    } else if (args.includes("annotate")) {
      const assignment = args.find((arg) => arg.startsWith(`${rolledKey}=`));
      if (assignment !== undefined) {
        cluster.secret = {
          ...cluster.secret,
          [rolledKey]: assignment.slice(rolledKey.length + 1),
        };
      }
    } else if (args.includes("rollout") && cluster.restartFails) {
      throw new Error("the connection to the server was refused");
    }
    return { stdout: read(args, cluster), stderr: "", code: 0 };
  });
  const runner: Runner = { run };
  return { runner, run };
}

/** The arguments of each kubectl call that rolls a Deployment, in call order. */
function restarts(run: Calls) {
  return run.mock.calls.flatMap(([command, args]) =>
    command === "kubectl" && args.includes("rollout") ? [args] : [],
  );
}

/** The arguments of each kubectl call that records a rolled checksum, in call order. */
function records(run: Calls) {
  return run.mock.calls.flatMap(([command, args]) =>
    command === "kubectl" && args.includes("annotate") ? [args] : [],
  );
}

/** Each kubectl call as apply, restart, record, or read, in call order. */
function steps(run: Calls) {
  return run.mock.calls.flatMap(([command, args]) => {
    if (command !== "kubectl") {
      return [];
    }
    if (args.includes("rollout")) {
      return ["restart"];
    }
    if (args.includes("annotate")) {
      return ["record"];
    }
    return [args.includes("apply") ? "apply" : "read"];
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

/** The arguments that record the rolled checksum on the token Secret, never on the Deployment. */
const externalDnsRecord = [
  "--context",
  "kore-vps",
  "--namespace",
  "kore-external-dns",
  "annotate",
  "secret",
  "cloudflare-token",
  `${rolledKey}=${externalChecksum}`,
  "--overwrite",
];

const externalDocuments = {
  [externalDocument]: decrypted("kore-external-dns", externalToken),
};

const vps = (features: Record<string, boolean>) =>
  fakeRepository({
    name: "vps",
    provider: "managed",
    kubeContext: "kore-vps",
    features,
  });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(readFile).mockResolvedValue(Buffer.from("ciphertext-external"));
  vi.mocked(withSecretsRedacted).mockImplementation(
    async (_secrets, operation) => await operation(),
  );
  vi.mocked(featureEnabled).mockImplementation(
    (environment, flag) => environment.features?.[flag] === true,
  );
  vi.mocked(isLocalProvider).mockImplementation(
    (environment) => environment.provider === "k3d",
  );
});

test("a replaced external-dns document applies its Secret, restarts the external-dns Deployment once, then records the rolled checksum on the Secret", async () => {
  const cluster = rolledAt(previousChecksum);
  const { runner, run } = runnerWith(externalDocuments, cluster);

  await applyCloudflareTokens(vps({ "external-dns": true }), runner);

  expect(steps(run)).toEqual(["read", "read", "apply", "restart", "record"]);
  expect(restarts(run)).toEqual([externalDnsRestart]);
  expect(records(run)).toEqual([externalDnsRecord]);
  expect(cluster.secret?.[rolledKey]).toEqual(externalChecksum);
});

test("every kubectl call names the configured context, the restart and the record included, never the current one", async () => {
  const { runner, run } = runnerWith(
    externalDocuments,
    rolledAt(previousChecksum),
  );

  await applyCloudflareTokens(vps({ "external-dns": true }), runner);

  const contexts = run.mock.calls
    .filter(([command]) => command === "kubectl")
    .map(([, args]) => args[args.indexOf("--context") + 1]);
  expect(contexts).toHaveLength(5);
  expect(new Set(contexts)).toEqual(new Set(["kore-vps"]));
});

test("an unchanged external-dns document applies again and restarts nothing, so rerunning kore secrets tokens is idempotent", async () => {
  const { runner, run } = runnerWith(
    externalDocuments,
    rolledAt(externalChecksum),
  );

  await applyCloudflareTokens(vps({ "external-dns": true }), runner);

  expect(restarts(run)).toEqual([]);
  expect(records(run)).toEqual([]);
  expect(steps(run).filter((step) => step === "apply")).toHaveLength(1);
});

test("a first apply, with no Secret and no external-dns Deployment yet, applies the Secret and restarts nothing", async () => {
  const cluster: Cluster = { deployment: false, restartFails: false };
  const { runner, run } = runnerWith(externalDocuments, cluster);

  await applyCloudflareTokens(vps({ "external-dns": true }), runner);

  expect(restarts(run)).toEqual([]);
  expect(records(run)).toEqual([]);
  expect(steps(run).filter((step) => step === "apply")).toHaveLength(1);
  expect(cluster.secret?.[documentKey]).toEqual(externalChecksum);
});

test("a replaced external-dns document restarts nothing while no external-dns Deployment exists, and records nothing", async () => {
  const { runner, run } = runnerWith(
    externalDocuments,
    rolledAt(previousChecksum, false),
  );

  await applyCloudflareTokens(vps({ "external-dns": true }), runner);

  expect(restarts(run)).toEqual([]);
  expect(records(run)).toEqual([]);
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
      ...externalDocuments,
      [acmeDocument]: decrypted("cert-manager", "test-token-cert-manager"),
    },
    rolledAt(externalChecksum),
  );

  await applyCloudflareTokens(
    vps({ "external-dns": true, "acme-dns01": true }),
    runner,
  );

  expect(acmeChecksum).not.toEqual(externalChecksum);
  expect(restarts(run)).toEqual([]);
  expect(records(run)).toEqual([]);
  expect(steps(run).filter((step) => step === "apply")).toHaveLength(2);
});

test("with the external-dns flag off nothing is restarted or recorded, even when the acme-dns01 document changed", async () => {
  vi.mocked(readFile).mockResolvedValue(Buffer.from("ciphertext-acme"));
  const { runner, run } = runnerWith(
    { [acmeDocument]: decrypted("cert-manager", "test-token-cert-manager") },
    rolledAt(previousChecksum),
  );

  await applyCloudflareTokens(vps({ "acme-dns01": true }), runner);

  expect(restarts(run)).toEqual([]);
  expect(records(run)).toEqual([]);
  expect(steps(run).filter((step) => step === "apply")).toHaveLength(1);
});

test("a restart that fails after the Secret applied names the rollout command to run by hand, and records nothing", async () => {
  const cluster = { ...rolledAt(previousChecksum), restartFails: true };
  const { runner, run } = runnerWith(externalDocuments, cluster);

  await expect(
    applyCloudflareTokens(vps({ "external-dns": true }), runner),
  ).rejects.toThrow(
    "kubectl --context kore-vps --namespace kore-external-dns rollout restart deployment/external-dns",
  );
  expect(records(run)).toEqual([]);
  expect(cluster.secret?.[documentKey]).toEqual(externalChecksum);
  expect(cluster.secret?.[rolledKey]).toEqual(previousChecksum);
});

test("a failed restart is retried by a rerun, which restarts the Deployment once and then records the rolled checksum", async () => {
  const cluster = { ...rolledAt(previousChecksum), restartFails: true };
  const { runner, run } = runnerWith(externalDocuments, cluster);
  const repository = vps({ "external-dns": true });

  await expect(applyCloudflareTokens(repository, runner)).rejects.toThrow(
    "restarting its Deployment failed",
  );
  run.mockClear();
  cluster.restartFails = false;
  await applyCloudflareTokens(repository, runner);

  expect(restarts(run)).toEqual([externalDnsRestart]);
  expect(records(run)).toEqual([externalDnsRecord]);
  expect(cluster.secret?.[rolledKey]).toEqual(externalChecksum);
});

test("a successful restart, then a rerun, restarts nothing and records nothing new", async () => {
  const { runner, run } = runnerWith(
    externalDocuments,
    rolledAt(previousChecksum),
  );
  const repository = vps({ "external-dns": true });

  await applyCloudflareTokens(repository, runner);
  run.mockClear();
  await applyCloudflareTokens(repository, runner);

  expect(restarts(run)).toEqual([]);
  expect(records(run)).toEqual([]);
  expect(steps(run).filter((step) => step === "apply")).toHaveLength(1);
});
