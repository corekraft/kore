// Docs: docs/decisions/0161-cert-manager-solves-dns-01-through-cloudflare-and-issues-per-suborg-wildcards-behind-acme-dns01.md
import { beforeEach, expect, test, vi } from "vitest";
import type { Component, Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { activeTokenConsumers } from "../security/index.js";
import { assertAcmeTokenSecret } from "./acme-dns01-token.js";

vi.mock("../security/index.js", () => ({
  activeTokenConsumers: vi.fn(),
  cloudflareTokenSecretName: "cloudflare-token",
}));

type Run = Runner["run"];

const repository = {
  environment: { name: "vps", kubeContext: "kore-vps" },
} as unknown as Repository;

const certificate = { name: "kore-local-tls" } as Component;

const acmeConsumer = {
  name: "acme-dns01",
  flag: "acme-dns01",
  namespace: "cert-manager",
  document: "cloudflare-acme-dns01.enc.yaml",
};

const readSecret = [
  "--context",
  "kore-vps",
  "--namespace",
  "cert-manager",
  "get",
  "secret/cloudflare-token",
  "--output",
  "name",
];

/** A runner that answers the one kubectl read it is given with the reply, or throws it. */
function runnerReplying(reply: string | Error) {
  const run = vi.fn<Run>(async () => {
    if (reply instanceof Error) {
      throw reply;
    }
    return { stdout: reply, stderr: "", code: 0 };
  });
  return { runner: { run } as Runner, run };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(activeTokenConsumers).mockReturnValue([acmeConsumer]);
});

test("with the acme-dns01 flag off there is no acme consumer, so nothing is read from the cluster", async () => {
  vi.mocked(activeTokenConsumers).mockReturnValue([]);
  const { runner, run } = runnerReplying("secret/cloudflare-token");
  await assertAcmeTokenSecret(repository, runner, certificate);
  expect(run).not.toHaveBeenCalled();
});

test("a component other than the platform certificate reads nothing, even with the flag on", async () => {
  const { runner, run } = runnerReplying("secret/cloudflare-token");
  await assertAcmeTokenSecret(repository, runner, {
    name: "kore-platform-config",
  } as Component);
  expect(run).not.toHaveBeenCalled();
});

test("with the token Secret present, the certificate proceeds, and the read asks for the name only so the value never leaves the cluster", async () => {
  const { runner, run } = runnerReplying("secret/cloudflare-token\n");
  await assertAcmeTokenSecret(repository, runner, certificate);
  expect(run).toHaveBeenCalledWith("kubectl", readSecret, { capture: true });
});

test("with the token Secret absent, the install is refused naming the Secret, its document and the fix", async () => {
  const { runner } = runnerReplying(
    new Error(
      'Error from server (NotFound): secrets "cloudflare-token" not found',
    ),
  );
  await expect(
    assertAcmeTokenSecret(repository, runner, certificate),
  ).rejects.toThrow(
    "cert-manager/cloudflare-token is not applied, so the acme-dns01 issuers cannot solve DNS-01; create infra/environments/vps/secrets/cloudflare-acme-dns01.enc.yaml with sops, then run kore secrets tokens --environment vps",
  );
});

test("an unreachable cluster is not reported as an absent Secret: the original error is rethrown", async () => {
  const unreachable = new Error("kubectl: connection refused");
  const { runner } = runnerReplying(unreachable);
  await expect(
    assertAcmeTokenSecret(repository, runner, certificate),
  ).rejects.toBe(unreachable);
});
