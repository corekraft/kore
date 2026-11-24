// Docs: docs/decisions/0164-the-platform-domain-is-a-run-time-value-and-the-repository-holds-a-placeholder.md, docs/decisions/0163-one-cloudflare-zone-holds-the-platform-domain-opentofu-owns-fixed-records-and-external-dns-owns-route-records.md
import { beforeEach, expect, test, vi } from "vitest";
import { isLocalProvider } from "../config/index.js";
import { activeTokenConsumers } from "../security/index.js";
import type { Runner } from "../runtime/index.js";
import { fakeRepository, fakeRunner } from "./diagnostics-support.js";
import { tokenSecretChecks } from "./token-secret-check.js";

vi.mock("../config/index.js", () => ({ isLocalProvider: vi.fn() }));
vi.mock("../security/index.js", () => ({
  activeTokenConsumers: vi.fn(),
  cloudflareTokenSecretName: "cloudflare-token",
}));

const externalDns = {
  name: "external-dns",
  flag: "external-dns",
  namespace: "kore-external-dns",
  document: "cloudflare-external-dns.enc.yaml",
};
const acmeDns01 = {
  name: "acme-dns01",
  flag: "acme-dns01",
  namespace: "cert-manager",
  document: "cloudflare-acme-dns01.enc.yaml",
};
const vps = fakeRepository({
  name: "vps",
  provider: "managed",
  kubeContext: "kore-vps",
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isLocalProvider).mockReturnValue(false);
  vi.mocked(activeTokenConsumers).mockReturnValue([externalDns]);
});

test("a consumer whose token Secret exists reports present by name, and the probe reads only its name, never its value", async () => {
  const { runner, run } = fakeRunner(() => "secret/cloudflare-token\n");

  const checks = await tokenSecretChecks(vps, runner);

  expect(checks).toEqual([
    {
      name: "token:external-dns",
      status: "pass",
      required: false,
      message: "present: kore-external-dns/cloudflare-token",
    },
  ]);
  expect(run).toHaveBeenCalledWith(
    "kubectl",
    [
      "--context",
      "kore-vps",
      "--namespace",
      "kore-external-dns",
      "get",
      "secret",
      "cloudflare-token",
      "--ignore-not-found",
      "--output",
      "name",
    ],
    { capture: true },
  );
});

test("an absent token Secret warns and names the document to encrypt and the command that applies it", async () => {
  const { runner } = fakeRunner(() => "");

  expect(await tokenSecretChecks(vps, runner)).toEqual([
    {
      name: "token:external-dns",
      status: "warn",
      required: false,
      message:
        "absent: kore-external-dns/cloudflare-token is not applied; create infra/environments/vps/secrets/cloudflare-external-dns.enc.yaml with sops, then run kore secrets tokens --environment vps",
    },
  ]);
});

test("a token Secret the cluster cannot be asked about warns with the cause and does not fail doctor", async () => {
  const runner = {
    run: vi.fn(async () => {
      throw new Error("kubectl: connection refused");
    }),
  } as unknown as Runner;

  expect(await tokenSecretChecks(vps, runner)).toEqual([
    {
      name: "token:external-dns",
      status: "warn",
      required: false,
      message:
        "kore-external-dns/cloudflare-token could not be read: kubectl: connection refused; check that the cluster is reachable",
    },
  ]);
});

test("each consumer is probed in its own namespace, in consumer order", async () => {
  vi.mocked(activeTokenConsumers).mockReturnValue([externalDns, acmeDns01]);
  const { runner, run } = fakeRunner((_command, args) =>
    args.includes("cert-manager") ? "secret/cloudflare-token\n" : "",
  );

  const checks = await tokenSecretChecks(vps, runner);

  expect(checks.map(({ name, status }) => [name, status])).toEqual([
    ["token:external-dns", "warn"],
    ["token:acme-dns01", "pass"],
  ]);
  expect(run.mock.calls.map(([, args]) => args[3])).toEqual([
    "kore-external-dns",
    "cert-manager",
  ]);
});

test("with no flag on, doctor probes nothing and reports nothing", async () => {
  vi.mocked(activeTokenConsumers).mockReturnValue([]);
  const { runner, run } = fakeRunner();

  expect(await tokenSecretChecks(vps, runner)).toEqual([]);
  expect(run).not.toHaveBeenCalled();
});

test("a local environment is never checked, because its external-dns needs no token", async () => {
  vi.mocked(isLocalProvider).mockReturnValue(true);
  vi.mocked(activeTokenConsumers).mockReturnValue([externalDns]);
  const { runner, run } = fakeRunner();

  expect(await tokenSecretChecks(vps, runner)).toEqual([]);
  expect(run).not.toHaveBeenCalled();
});
