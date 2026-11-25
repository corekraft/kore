// Docs: docs/decisions/0157-a-name-under-another-domain-is-served-after-an-http-01-proof-and-certificates-come-from-acme.md
import { expect, test, vi, beforeEach } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import {
  foreignCertificateName,
  foreignCertificateNames,
  loadForeignCertificateNames,
} from "./foreign-certificates.js";
import type { ServiceClaim } from "./hostname-claims.js";

test("the Certificate of a foreign name is named as the chart names it: foreign, its dots as dashes, and eight hex digits of its SHA-256", () => {
  expect(foreignCertificateName("pay.example.net")).toBe(
    "foreign-pay-example-net-fe743658",
  );
  expect(foreignCertificateName("a.example.org")).toBe(
    "foreign-a-example-org-8479b785",
  );
  expect(foreignCertificateName("a-example.org")).not.toBe(
    foreignCertificateName("a.example.org"),
  );
});

test("a long foreign name is cut to forty characters before its hash, with no trailing dash", () => {
  const name = foreignCertificateName(
    "a-very-long-service-name-for-the-shop.example.org",
  );
  expect(name).toBe(
    "foreign-a-very-long-service-name-for-the-shop-ex-a787cd3d",
  );
});

vi.mock("node:fs/promises", () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
}));

// The hostname rules are a unit of their own (hostname-claims.spec.ts). Here they are
// stood in for by explicit implementations that state the rule each applies.
vi.mock("./hostname-claims.js", () => ({
  formError: (host: string): string[] =>
    host !== host.toLowerCase() || host.includes("*")
      ? [`refused ${host}`]
      : [],
  resolveHostname: (host: string, domain: string) => {
    const inDomain = host === domain || host.endsWith(`.${domain}`);
    return {
      name: host.includes(".") ? host : `${host}.${domain}`,
      foreign: host.includes(".") && !inDomain,
    };
  },
}));

// The domain below is the documentation value example.com, never a real one.
const domain = "example.com";
const servicesDirectory = "infra/environments/vps/services";

const service = (
  name: string,
  gateway: unknown,
  hostnames: unknown,
): ServiceClaim => ({
  file: `infra/environments/vps/services/${name}.json`,
  name,
  organization: "shop",
  gateway,
  hostnames,
});

test("each foreign name a service claims on the external Gateway is listed once, in sorted order", () => {
  const names = foreignCertificateNames(
    [
      service("shop", "external", ["shop.example.org", "login"]),
      service("billing", "external", ["shop.example.org", "pay.example.net"]),
    ],
    domain,
  );
  expect(names).toEqual(["pay.example.net", "shop.example.org"]);
});

test("a foreign name on the internal Gateway is not listed, since a foreign name is served only on the external Gateway", () => {
  const names = foreignCertificateNames(
    [service("shop", "internal", ["shop.example.org"])],
    domain,
  );
  expect(names).toEqual([]);
});

test("a service with no gateway field is internal, so its foreign names are not listed", () => {
  const names = foreignCertificateNames(
    [service("shop", undefined, ["shop.example.org"])],
    domain,
  );
  expect(names).toEqual([]);
});

test("a name under the platform domain or a bare label is not listed, since the platform owns its zone", () => {
  const names = foreignCertificateNames(
    [service("shop", "external", ["login", `shop.${domain}`, `${domain}`])],
    domain,
  );
  expect(names).toEqual([]);
});

test("a name the form rules refuse, such as a wildcard or an uppercase name, is not listed", () => {
  const names = foreignCertificateNames(
    [service("shop", "external", ["*.example.org", "Shop.example.org"])],
    domain,
  );
  expect(names).toEqual([]);
});

test("a record whose hostnames are not a list, or are not strings, contributes nothing", () => {
  const names = foreignCertificateNames(
    [
      service("shop", "external", "shop.example.org"),
      service("billing", "external", [42, null]),
    ],
    domain,
  );
  expect(names).toEqual([]);
});

beforeEach(() => {
  vi.resetAllMocks();
});

test("the loader reads each service spec and ignores release files and files that are not spec JSON", async () => {
  vi.mocked(readdir).mockResolvedValue([
    "shop.json",
    "shop.release.json",
    "notes.txt",
  ] as never);
  vi.mocked(readFile).mockResolvedValue(
    JSON.stringify({
      spec: {
        organization: "shop",
        gateway: "external",
        hostnames: ["shop.example.org"],
      },
    }) as never,
  );
  const names = await loadForeignCertificateNames(
    "/repo",
    servicesDirectory,
    domain,
  );
  expect(names).toEqual(["shop.example.org"]);
  expect(vi.mocked(readdir)).toHaveBeenCalledWith(
    "/repo/infra/environments/vps/services",
  );
  expect(vi.mocked(readFile).mock.calls).toEqual([
    ["/repo/infra/environments/vps/services/shop.json", "utf8"],
  ]);
});

test("a spec that is not strict JSON is skipped, since validate reports it", async () => {
  vi.mocked(readdir).mockResolvedValue(["broken.json"] as never);
  vi.mocked(readFile).mockResolvedValue("{ not json" as never);
  expect(
    await loadForeignCertificateNames("/repo", servicesDirectory, domain),
  ).toEqual([]);
});

test("an environment with no services directory has no foreign names", async () => {
  const missing = Object.assign(new Error("no such directory"), {
    code: "ENOENT",
  });
  vi.mocked(readdir).mockRejectedValue(missing);
  expect(
    await loadForeignCertificateNames("/repo", servicesDirectory, domain),
  ).toEqual([]);
});
