// Docs: docs/decisions/0161-cert-manager-solves-dns-01-through-cloudflare-and-issues-per-suborg-wildcards-behind-acme-dns01.md
import { beforeEach, expect, test, vi } from "vitest";
import { acmeDns01HelmArgs } from "./acme-dns01.js";
import { dnsHelmArgs } from "./dns-helm-args.js";
import { externalDnsHelmArgs } from "./external-dns.js";
import type { Environment } from "./types.js";

vi.mock("./acme-dns01.js", () => ({ acmeDns01HelmArgs: vi.fn() }));
vi.mock("./external-dns.js", () => ({ externalDnsHelmArgs: vi.fn() }));

const environment = {
  name: "vps",
  provider: "managed",
} as unknown as Environment;
const env = { KORE_PLATFORM_DOMAIN: "example.com" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(externalDnsHelmArgs).mockReturnValue(["external-dns-arg"]);
  vi.mocked(acmeDns01HelmArgs).mockReturnValue(["acme-dns01-arg"]);
});

test("a component takes the external-dns arguments first, then the acme-dns01 arguments, each for the same environment and component", () => {
  expect(dnsHelmArgs(environment, "cert-manager", env)).toEqual([
    "external-dns-arg",
    "acme-dns01-arg",
  ]);
  expect(vi.mocked(externalDnsHelmArgs).mock.calls).toEqual([
    [environment, "cert-manager", env],
  ]);
  expect(vi.mocked(acmeDns01HelmArgs).mock.calls).toEqual([
    [environment, "cert-manager", env],
  ]);
});

test("a component that takes neither flag's arguments gets none", () => {
  vi.mocked(externalDnsHelmArgs).mockReturnValue([]);
  vi.mocked(acmeDns01HelmArgs).mockReturnValue([]);
  expect(dnsHelmArgs(environment, "kore-platform-config", env)).toEqual([]);
});
