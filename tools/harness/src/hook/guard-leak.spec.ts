// The platform-domain leak rule: which value the run-time variable names, and the warning a
// write that names it raises. `warn` is mocked, as the other rule units do.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { domainLeak, platformDomainOf } from "./guard-leak.js";

const PLATFORM_DOMAIN_RULE = "platform-domain-leak";
import { warn, type Hit } from "./guard-verdict.js";

vi.mock("./guard-verdict.js");

// A reserved test domain stands in for the owner's bought name, which no spec ever writes.
const DOMAIN = "platform.example.com";

beforeEach(() => {
  vi.mocked(warn).mockImplementation((rule: string, message: string): Hit => ({
    action: "warn",
    rule,
    message,
  }));
});

describe("platformDomainOf", () => {
  it("reads the run-time variable, trimmed and lower-cased", () => {
    expect(
      platformDomainOf({ KORE_PLATFORM_DOMAIN: `  ${DOMAIN.toUpperCase()}  ` }),
    ).toBe(DOMAIN);
  });

  it("reads nothing when the variable is unset or blank", () => {
    expect(platformDomainOf({})).toBeUndefined();
    expect(platformDomainOf({ KORE_PLATFORM_DOMAIN: "" })).toBeUndefined();
    expect(platformDomainOf({ KORE_PLATFORM_DOMAIN: "   " })).toBeUndefined();
  });

  it("reads nothing for a name the repository already holds", () => {
    for (const name of ["kore.internal", "kore.local", "example.com"]) {
      expect(platformDomainOf({ KORE_PLATFORM_DOMAIN: name })).toBeUndefined();
    }
  });
});

describe("domainLeak", () => {
  it("raises nothing when no domain is set, whatever the text", () => {
    expect(domainLeak(`login.${DOMAIN}`, undefined)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("raises nothing when the text does not name the domain", () => {
    expect(domainLeak("write example.com instead", DOMAIN)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns under the platform-domain-leak rule when the text names the domain", () => {
    const finding = domainLeak(`curl https://${DOMAIN}/health`, DOMAIN);
    expect(finding).toMatchObject({
      action: "warn",
      rule: PLATFORM_DOMAIN_RULE,
    });
    expect(warn).toHaveBeenCalledWith(PLATFORM_DOMAIN_RULE, expect.any(String));
  });

  it("names the fix, and never echoes the value", () => {
    domainLeak(`see login.${DOMAIN}`, DOMAIN);
    const message = vi.mocked(warn).mock.calls[0]?.[1] ?? "";
    expect(message).toContain("Instead, write example.com");
    expect(message).not.toContain(DOMAIN);
    expect(message).not.toContain("platform.example");
  });

  it("matches the domain in any case, and under a subdomain of it", () => {
    expect(domainLeak(`LOGIN.${DOMAIN.toUpperCase()}`, DOMAIN)).not.toBeNull();
    expect(domainLeak(`api.login.${DOMAIN}`, DOMAIN)).not.toBeNull();
    expect(domainLeak(`host: ${DOMAIN}`, DOMAIN)).not.toBeNull();
  });

  it("does not match a longer name that only ends or starts with the domain", () => {
    expect(domainLeak(`x${DOMAIN}`, DOMAIN)).toBeNull();
    expect(domainLeak(`my-${DOMAIN}`, DOMAIN)).toBeNull();
    expect(domainLeak(`${DOMAIN}-old`, DOMAIN)).toBeNull();
    expect(domainLeak(`${DOMAIN}x`, DOMAIN)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("matches the dots in the domain literally, not as any character", () => {
    expect(domainLeak("platformXexampleXcom", DOMAIN)).toBeNull();
  });

  it("warns once for a text that names the domain on many lines", () => {
    const text = `first ${DOMAIN}\nsecond ${DOMAIN}\n`;
    expect(domainLeak(text, DOMAIN)).toMatchObject({
      action: "warn",
      rule: PLATFORM_DOMAIN_RULE,
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
