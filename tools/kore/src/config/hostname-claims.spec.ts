// Docs: docs/decisions/0159-services-attach-to-the-platform-gateways-through-listener-sets-and-hostname-claims.md
import { expect, test, vi } from "vitest";
import {
  hostnameClaimErrors,
  resolveHostname,
  type ClaimEnvironment,
  type ServiceClaim,
  type SuborgRecord,
} from "./hostname-claims.js";

// The name derivation is a unit of its own (service-names.spec.ts). Here it is stood in
// for by explicit implementations that state the rule it applies.
vi.mock("./service-names.js", () => ({
  placeholderPlatformDomain: "kore.internal",
  suborgZone: (organization: string, domain: string): string =>
    `${organization}.${domain}`,
  isClaim: (host: string, organization: string, domain: string): boolean => {
    const suffix = `.${domain}`;
    if (!host.endsWith(suffix)) {
      return false;
    }
    const rest = host.slice(0, -suffix.length);
    return !rest.includes(".") && rest !== organization;
  },
}));

const local: ClaimEnvironment = {
  domain: "example.com",
  internalDomain: "example.com",
  externalGateway: false,
  placeholder: false,
};

const external: ClaimEnvironment = {
  domain: "example.com",
  internalDomain: "internal.example.com",
  externalGateway: true,
  placeholder: false,
};

const suborgs: SuborgRecord[] = [
  { name: "api", file: "infra/environments/local/organizations/api.json" },
  {
    name: "billing",
    file: "infra/environments/local/organizations/billing.json",
  },
];

const reserved = new Set(["www", "mail", "internal", "platform", "kore"]);

/** A service record in suborg api, listing the given hostnames on the internal Gateway by default. */
function leads(
  hostnames: unknown,
  overrides: Partial<ServiceClaim> = {},
): ServiceClaim {
  return {
    file: "infra/environments/local/services/leads.json",
    name: "leads",
    organization: "api",
    gateway: "internal",
    hostnames,
    ...overrides,
  };
}

function quotes(hostnames: unknown): ServiceClaim {
  return {
    file: "infra/environments/local/services/quotes.json",
    name: "quotes",
    organization: "billing",
    gateway: "internal",
    hostnames,
  };
}

const check = (
  services: ServiceClaim[],
  environment: ClaimEnvironment = local,
  records: SuborgRecord[] = suborgs,
) =>
  hostnameClaimErrors({
    environment,
    services,
    suborgs: records,
    reserved,
  });

const leadsFile = "infra/environments/local/services/leads.json";

test("a name inside the claimant's own suborg zone needs no claim and passes", () => {
  expect(check([leads(["shop.api.example.com"])])).toEqual([]);
});

test("the apex of the claimant's own zone is not a claim and passes, written as its label", () => {
  expect(check([leads(["api"])])).toEqual([]);
});

test("a relative label that no record holds passes, as a claim on the label under the platform domain", () => {
  expect(check([leads(["login"])])).toEqual([]);
});

test("a relative label resolves to the label plus the platform domain, and is not foreign", () => {
  expect(resolveHostname("login", "example.com")).toEqual({
    name: "login.example.com",
    foreign: false,
  });
});

test("a full hostname under a foreign domain resolves to itself and is marked foreign, for the HTTP-01 path", () => {
  expect(resolveHostname("login.example.org", "example.com")).toEqual({
    name: "login.example.org",
    foreign: true,
  });
});

test("a full hostname in the platform domain's own zone resolves to itself and is not foreign", () => {
  expect(resolveHostname("shop.api.example.com", "example.com")).toEqual({
    name: "shop.api.example.com",
    foreign: false,
  });
});

test("a relative label on an external Gateway is a claim on the platform domain and passes", () => {
  expect(check([leads(["login"], { gateway: "external" })], external)).toEqual(
    [],
  );
});

test("a service with no hostnames list has nothing to check", () => {
  expect(check([leads(undefined)])).toEqual([]);
});

test("a second record cannot claim a name the first holds, and the message names the holder", () => {
  expect(check([leads(["login"]), quotes(["login"])])).toEqual([
    'infra/environments/local/services/quotes.json: spec.hostnames[0] "login.example.com" is already claimed by infra/environments/local/services/leads.json (service leads in suborg api): the first claim holds a name exclusively; remove it from this record or choose another name',
  ]);
});

test("deleting the holder's record makes the other record's claim valid", () => {
  expect(check([quotes(["login"])])).toEqual([]);
});

test("a name listed twice in one record is refused, naming the repeat", () => {
  expect(check([leads(["login", "login"])])).toEqual([
    `${leadsFile}: spec.hostnames[1] "login.example.com" is listed twice: remove the repeat`,
  ]);
});

test("a wildcard is refused, with an exact label to list instead", () => {
  expect(check([leads(["*.example.com"])])).toEqual([
    `${leadsFile}: spec.hostnames[0] "*.example.com" is a wildcard: wildcards are refused in v1; list the exact name, for example login`,
  ]);
});

test("the apex of the platform domain is refused, without printing the domain", () => {
  const errors = check([leads(["example.com"])]);
  expect(errors).toEqual([
    `${leadsFile}: spec.hostnames[0] is the apex of the platform domain: the apex is refused; write a label, for example login`,
  ]);
  expect(errors.join("\n")).not.toContain("example.com");
});

test("an IP literal is refused, with a DNS name to list instead", () => {
  expect(check([leads(["192.0.2.10"])])).toEqual([
    `${leadsFile}: spec.hostnames[0] "192.0.2.10" is an IP address: list a DNS name, for example login`,
  ]);
});

test("a punycode name is refused in v1", () => {
  expect(check([leads(["xn--bcher-kva.example.org"])])).toEqual([
    `${leadsFile}: spec.hostnames[0] "xn--bcher-kva.example.org" is a punycode (xn--) name: punycode names are refused in v1; list the name in plain letters and digits, for example login`,
  ]);
});

test("a punycode label under the platform domain is refused as punycode, not as a label", () => {
  expect(check([leads(["xn--bcher-kva.example.com"])])).toEqual([
    `${leadsFile}: spec.hostnames[0] "xn--bcher-kva.example.com" is a punycode (xn--) name: punycode names are refused in v1; list the name in plain letters and digits, for example login`,
  ]);
});

test("an upper-case label is refused, with the lower-case form to write", () => {
  expect(check([leads(["Login"])])).toEqual([
    `${leadsFile}: spec.hostnames[0] "Login" must be lowercase; write "login"`,
  ]);
});

test("a name that is not a DNS label is refused, with a label to list instead", () => {
  expect(check([leads(["bad_name"])])).toEqual([
    `${leadsFile}: spec.hostnames[0] "bad_name" must be a lowercase DNS name of letters, digits and hyphens: a label such as login, or a full hostname under another domain`,
  ]);
});

test("a hostnames entry that is not a string is refused, naming the label form", () => {
  expect(check([leads([42])])).toEqual([
    `${leadsFile}: spec.hostnames[0] must be a string: a label such as login, or a full hostname under another domain`,
  ]);
});

test("a full hostname under the platform domain is refused, naming the label alone and never the domain", () => {
  const errors = check([leads(["login.example.com"])]);
  expect(errors).toEqual([
    `${leadsFile}: spec.hostnames[0] is a full hostname under the platform domain: write the label alone, "login", and the platform domain is added to it`,
  ]);
  expect(errors.join("\n")).not.toContain("example.com");
});

test("an upper-case full hostname under the platform domain is refused by its label, not echoed", () => {
  const errors = check([leads(["Login.EXAMPLE.com"])]);
  expect(errors).toEqual([
    `${leadsFile}: spec.hostnames[0] is a full hostname under the platform domain: write the label alone, "login", and the platform domain is added to it`,
  ]);
  expect(errors.join("\n")).not.toMatch(/example\.com/i);
});

test("a name in another suborg's zone is refused, and the message names that zone", () => {
  expect(check([leads(["shop.billing.example.com"])])).toEqual([
    `${leadsFile}: spec.hostnames[0] "shop.billing.example.com" is in the zone of billing (billing.example.com), another organization's zone: list a name in api.example.com or directly under example.com, for example login.example.com`,
  ]);
});

test("a name in the platform organization's zone is refused for a suborg", () => {
  expect(check([leads(["shop.platform.example.com"])])).toEqual([
    `${leadsFile}: spec.hostnames[0] "shop.platform.example.com" is in the zone of platform (platform.example.com), another organization's zone: list a name in api.example.com or directly under example.com, for example login.example.com`,
  ]);
});

test("a name under a zone that no organization owns is refused", () => {
  expect(check([leads(["x.nobody.example.com"])])).toEqual([
    `${leadsFile}: spec.hostnames[0] "x.nobody.example.com" is under nobody.example.com, which no organization owns: name a host directly under example.com, for example login.example.com, or a name in your own zone, for example shop.api.example.com`,
  ]);
});

test("a claim equal to an existing suborg's name is refused, naming that suborg's zone and the suborg's own record", () => {
  expect(check([leads(["billing"])])).toEqual([
    `${leadsFile}: spec.hostnames[0] "billing.example.com" is the name of organization billing, whose zone is billing.example.com: a claim cannot take an organization's name; choose a name that no organization uses, for example billing-team.example.com`,
    "infra/environments/local/organizations/billing.json: suborg billing is named like the hostname billing.example.com claimed by infra/environments/local/services/leads.json (service leads): a suborg cannot take a name that a service claims; rename the suborg, or remove the claim",
  ]);
});

test("a relative label equal to a reserved name is refused, and the message points at the reserved file", () => {
  expect(check([leads(["www"])])).toEqual([
    `${leadsFile}: spec.hostnames[0] "www.example.com" is a reserved name: www cannot be claimed; the reserved names are in infra/catalog/reserved-hostnames.json; choose another name, for example www-app.example.com`,
  ]);
});

test("a suborg whose name a record claims is refused on the suborg's own record too", () => {
  const records = [
    ...suborgs,
    {
      name: "login",
      file: "infra/environments/local/organizations/login.json",
    },
  ];
  expect(check([quotes(["login"])], local, records)).toEqual([
    'infra/environments/local/services/quotes.json: spec.hostnames[0] "login.example.com" is the name of organization login, whose zone is login.example.com: a claim cannot take an organization\'s name; choose a name that no organization uses, for example login-team.example.com',
    "infra/environments/local/organizations/login.json: suborg login is named like the hostname login.example.com claimed by infra/environments/local/services/quotes.json (service quotes): a suborg cannot take a name that a service claims; rename the suborg, or remove the claim",
  ]);
});

test("gateway internal refuses a name under another domain, and names the internal domain", () => {
  expect(check([leads(["login.example.org"])], external)).toEqual([
    `${leadsFile}: spec.hostnames[0] "login.example.org" is under another domain: gateway internal serves names under internal.example.com; set gateway external, or list a name under internal.example.com`,
  ]);
});

test("with an external Gateway, gateway internal refuses a name under the platform domain but outside its internal domain", () => {
  expect(check([leads(["login"])], external)).toEqual([
    `${leadsFile}: spec.hostnames[0] "login.example.com" is under another domain: gateway internal serves names under internal.example.com; set gateway external, or list a name under internal.example.com`,
  ]);
});

test("with an external Gateway, a full hostname under the platform domain is still refused for its label form first", () => {
  expect(check([leads(["login.example.com"])], external)).toEqual([
    `${leadsFile}: spec.hostnames[0] is a full hostname under the platform domain: write the label alone, "login", and the platform domain is added to it`,
  ]);
});

test("with an external Gateway, the apex of the platform domain is refused as the apex, whatever the Gateway", () => {
  expect(check([leads(["example.com"])], external)).toEqual([
    `${leadsFile}: spec.hostnames[0] is the apex of the platform domain: the apex is refused; write a label, for example login`,
  ]);
});

test("gateway external leaves a name under another domain to the decision on names under other domains (ADR 0157)", () => {
  expect(
    check([leads(["login.example.org"], { gateway: "external" })], external),
  ).toEqual([]);
});

test("gateway external is refused when the environment declares no external Gateway", () => {
  expect(check([leads(undefined, { gateway: "external" })])).toEqual([
    `${leadsFile}: spec.gateway is external, but the environment declares no external Gateway: declare gateways.external in the environment, or set spec.gateway to internal`,
  ]);
});

test("gateway external is refused while the platform domain is the placeholder in force", () => {
  expect(
    check([leads(undefined, { gateway: "external" })], {
      ...external,
      domain: "kore.internal",
      internalDomain: "internal.kore.internal",
      placeholder: true,
    }),
  ).toEqual([
    `${leadsFile}: spec.gateway is external while the platform domain is the placeholder kore.internal: set KORE_PLATFORM_DOMAIN in the shell that runs kore to the platform domain (ADR 0164)`,
  ]);
});

test("a gateway internal service with an external Gateway may list a name in its own zone under the internal domain", () => {
  expect(check([leads(["shop.api.internal.example.com"])], external)).toEqual(
    [],
  );
});
