// Docs: docs/decisions/0157-a-name-under-another-domain-is-served-after-an-http-01-proof-and-certificates-come-from-acme.md
import { expect, test, vi, beforeEach } from "vitest";
import {
  foreignCertificateFailure,
  foreignCertificateMessage,
  foreignCertificateResources,
} from "./foreign-certificate.js";
import type { Component, Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";

// The name derivation belongs to config (foreign-certificates.spec.ts). Here it is stood in
// for by the rule it states, so this spec needs no hash.
vi.mock("../config/index.js", () => ({
  foreignCertificateName: (host: string): string =>
    `foreign-${host.replaceAll(".", "-")}`,
}));

// The domains below are the documentation values example.net and example.org, never real ones.
const repository = (foreignNames: string[]): Repository =>
  ({ foreignNames }) as unknown as Repository;

const component = (name: string): Component =>
  ({ name, namespace: "kore-system" }) as unknown as Component;

const base = ["--context", "kore-vps", "--namespace", "kore-system"];

beforeEach(() => {
  vi.resetAllMocks();
});

test("each foreign name waits on its own Certificate, and only the platform certificate component waits on them", () => {
  const names = ["pay.example.net", "shop.example.org"];
  expect(
    foreignCertificateResources(repository(names), component("kore-local-tls")),
  ).toEqual([
    "certificate/foreign-pay-example-net",
    "certificate/foreign-shop-example-org",
  ]);
  expect(
    foreignCertificateResources(repository(names), component("cert-manager")),
  ).toEqual([]);
});

test("with no foreign name, no foreign Certificate is waited on, so readiness is what it was", () => {
  expect(
    foreignCertificateResources(repository([]), component("kore-local-tls")),
  ).toEqual([]);
});

test("a name that does not resolve is named as the cause, with the A record that fixes it and the ACME error", () => {
  expect(
    foreignCertificateMessage(
      "pay.example.net",
      "Waiting for HTTP-01 challenge propagation: lookup pay.example.net: no such host",
    ),
  ).toBe(
    "foreign name pay.example.net is not proven: the public DNS of pay.example.net does not resolve to the platform. Fix: at the DNS provider of pay.example.net, create an A record for pay.example.net that points at the platform's external address (ADR 0160), then run kore platform up again. ACME said: Waiting for HTTP-01 challenge propagation: lookup pay.example.net: no such host",
  );
});

test("a name that resolves but cannot be reached on port 80 is named as the cause, not as a timeout", () => {
  expect(
    foreignCertificateMessage(
      "pay.example.net",
      "Waiting for HTTP-01 challenge propagation: dial tcp 203.0.113.9:80: connect: connection refused",
    ),
  ).toBe(
    "foreign name pay.example.net is not proven: port 80 of the platform's external address cannot be reached for pay.example.net. Fix: at the DNS provider of pay.example.net, create an A record for pay.example.net that points at the platform's external address (ADR 0160), then run kore platform up again. ACME said: Waiting for HTTP-01 challenge propagation: dial tcp 203.0.113.9:80: connect: connection refused",
  );
});

test("a name that reaches the platform but whose challenge path answers with another status is named as the cause", () => {
  expect(
    foreignCertificateMessage(
      "shop.example.org",
      "Waiting for HTTP-01 challenge propagation: wrong status code '404', expected '200'",
    ),
  ).toBe(
    "foreign name shop.example.org is not proven: shop.example.org reaches the platform but the challenge path is not served. Fix: at the DNS provider of shop.example.org, create an A record for shop.example.org that points at the platform's external address (ADR 0160), then run kore platform up again. ACME said: Waiting for HTTP-01 challenge propagation: wrong status code '404', expected '200'",
  );
});

test("a challenge reason no rule recognises still names the name and the reason, never a bare timeout", () => {
  expect(
    foreignCertificateMessage("shop.example.org", "something new went wrong"),
  ).toBe(
    "foreign name shop.example.org is not proven: the ACME challenge for shop.example.org did not pass. Fix: at the DNS provider of shop.example.org, create an A record for shop.example.org that points at the platform's external address (ADR 0160), then run kore platform up again. ACME said: something new went wrong",
  );
});

test("a foreign name with no challenge yet is named as not started, with the same fix", () => {
  expect(foreignCertificateMessage("shop.example.org", undefined)).toBe(
    "foreign name shop.example.org is not proven: no challenge exists yet, so its Certificate has not started. Fix: at the DNS provider of shop.example.org, create an A record for shop.example.org that points at the platform's external address (ADR 0160), then run kore platform up again.",
  );
});

test("the failure reads the challenges in the namespace and names the one for the resource it is given", async () => {
  const run = vi.fn().mockResolvedValue({
    stdout:
      "pay.example.net\tWaiting for HTTP-01 challenge propagation: lookup pay.example.net: no such host\nshop.example.org\tWaiting for HTTP-01 challenge propagation: wrong status code '404', expected '200'\n",
    stderr: "",
  });
  const runner = { run } as unknown as Runner;
  const message = await foreignCertificateFailure(
    runner,
    base,
    "certificate/foreign-shop-example-org",
    ["pay.example.net", "shop.example.org"],
  );
  expect(run).toHaveBeenCalledWith(
    "kubectl",
    [
      ...base,
      "get",
      "challenges.acme.cert-manager.io",
      "--output",
      'jsonpath={range .items[*]}{.spec.dnsName}{"\\t"}{.status.reason}{"\\n"}{end}',
    ],
    { capture: true },
  );
  expect(message).toBe(
    foreignCertificateMessage(
      "shop.example.org",
      "Waiting for HTTP-01 challenge propagation: wrong status code '404', expected '200'",
    ),
  );
});

test("a Certificate that no service record claims a foreign name for is named as unclaimed, with the command that finds the record", async () => {
  const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
  const runner = { run } as unknown as Runner;
  expect(
    await foreignCertificateFailure(
      runner,
      base,
      "certificate/foreign-x-example-org",
      ["shop.example.org"],
    ),
  ).toBe(
    "certificate/foreign-x-example-org is not proven: no service record claims a foreign name for it. Fix: run kore validate, then kore platform up again.",
  );
});
