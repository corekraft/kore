// Docs: docs/decisions/0162-external-dns-publishes-route-records-for-the-external-gateway-behind-external-dns.md, docs/decisions/0163-one-cloudflare-zone-holds-the-platform-domain-opentofu-owns-fixed-records-and-external-dns-owns-route-records.md
import { readFile } from "node:fs/promises";
import { beforeEach, expect, test, vi } from "vitest";
import { featureEnabled, isLocalProvider } from "../config/index.js";
import { withSecretsRedacted } from "../images/index.js";
import type { Runner, RunResult } from "../runtime/index.js";
import type { Run } from "./security-support.js";
import { fakeRepository } from "./security-support.js";
import { rollDeployment, rollsDeployment } from "./token-rollout.js";
import { applyCloudflareTokens } from "./cloudflare-token.js";

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
// sha256 of the encrypted bytes each test reads for the external-dns document.
const externalChecksum =
  "4541f1c75fd2dd20fbeda0815351f473c1b88c653f99e36b3fcc0a949e2d6c69";

/** The rollout target the external-dns consumer hands the rollout, in the configured context. */
const externalDnsTarget = {
  context: "kore-vps",
  name: "external-dns",
  namespace: "kore-external-dns",
  secret: "cloudflare-token",
  deployment: "external-dns",
  checksum: externalChecksum,
};

/** The decrypted document sops prints as JSON for a token Secret in a namespace. */
function decrypted(namespace: string, token: string) {
  return JSON.stringify({
    kind: "Secret",
    metadata: { name: "cloudflare-token", namespace },
    stringData: { "api-token": token },
  });
}

const documents: Record<string, string> = {
  [externalDocument]: decrypted("kore-external-dns", "test-token-external-dns"),
  [acmeDocument]: decrypted("cert-manager", "test-token-cert-manager"),
};

/**
 * A runner that answers sops from the documents and records every call, with
 * the rollout's decide and roll steps logged into the same order.
 */
function recordingRunner() {
  const order: string[] = [];
  const run = vi.fn<Run>(async (command, args): Promise<RunResult> => {
    order.push(args.includes("apply") ? "apply" : command);
    return {
      stdout: command === "sops" ? (documents[args.at(-1) ?? ""] ?? "") : "",
      stderr: "",
      code: 0,
    };
  });
  vi.mocked(rollsDeployment).mockImplementation(async () => {
    order.push("decide");
    return true;
  });
  vi.mocked(rollDeployment).mockImplementation(async () => {
    order.push("roll");
  });
  const runner: Runner = { run };
  return { runner, run, order };
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

test("a changed external-dns document is decided before its Secret applies and rolled after, with the configured context and its checksum", async () => {
  const { runner, order } = recordingRunner();

  await applyCloudflareTokens(vps({ "external-dns": true }), runner);

  expect(order).toEqual(["sops", "decide", "apply", "roll"]);
  expect(vi.mocked(rollsDeployment)).toHaveBeenCalledWith(
    externalDnsTarget,
    runner,
  );
  expect(vi.mocked(rollDeployment)).toHaveBeenCalledExactlyOnceWith(
    externalDnsTarget,
    runner,
  );
});

test("a document the rollout says is unchanged applies its Secret and rolls nothing", async () => {
  const { runner, order } = recordingRunner();
  vi.mocked(rollsDeployment).mockResolvedValue(false);

  await applyCloudflareTokens(vps({ "external-dns": true }), runner);

  expect(order).toEqual(["sops", "apply"]);
  expect(vi.mocked(rollDeployment)).not.toHaveBeenCalled();
});

test("the acme-dns01 consumer is never rolled, because cert-manager reads its token at challenge time", async () => {
  const { runner, order } = recordingRunner();

  await applyCloudflareTokens(vps({ "acme-dns01": true }), runner);

  expect(order).toEqual(["sops", "apply"]);
  expect(vi.mocked(rollsDeployment)).not.toHaveBeenCalled();
  expect(vi.mocked(rollDeployment)).not.toHaveBeenCalled();
});

test("with the external-dns flag off nothing is applied, decided or rolled for it", async () => {
  const { runner, run } = recordingRunner();

  await applyCloudflareTokens(vps({}), runner);

  expect(run).not.toHaveBeenCalled();
  expect(vi.mocked(rollsDeployment)).not.toHaveBeenCalled();
  expect(vi.mocked(rollDeployment)).not.toHaveBeenCalled();
});

test("a roll that fails fails the run after the Secret applied, so a rerun retries it", async () => {
  const { runner, order } = recordingRunner();
  vi.mocked(rollDeployment).mockRejectedValue(
    new Error("its new pod did not become ready within 5m"),
  );

  await expect(
    applyCloudflareTokens(vps({ "external-dns": true }), runner),
  ).rejects.toThrow("did not become ready");
  expect(order).toEqual(["sops", "decide", "apply"]);
});
