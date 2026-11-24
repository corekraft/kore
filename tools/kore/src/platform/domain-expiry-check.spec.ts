// Docs: docs/decisions/0163-one-cloudflare-zone-holds-the-platform-domain-opentofu-owns-fixed-records-and-external-dns-owns-route-records.md
import { beforeEach, expect, test, vi } from "vitest";
import type { Environment } from "../config/index.js";
import { runTimeDomain } from "../config/index.js";
import {
  DomainExpiryError,
  expiryNotice,
  parseRdapExpiry,
} from "./domain-expiry.js";
import { checkDomainExpiry } from "./domain-expiry-check.js";

vi.mock("../config/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../config/index.js")>()),
  runTimeDomain: vi.fn(),
}));

vi.mock("./domain-expiry.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./domain-expiry.js")>()),
  parseRdapExpiry: vi.fn(),
  expiryNotice: vi.fn(),
}));

const managed = { provider: "managed" } as Environment;
const now = new Date("2026-11-24T00:00:00Z");
const env: NodeJS.ProcessEnv = { KORE_PLATFORM_DOMAIN: "example.com" };
const expiresAt = new Date("2026-12-10T00:00:00Z");

const runTimeDomainMock = vi.mocked(runTimeDomain);
const parseMock = vi.mocked(parseRdapExpiry);
const noticeMock = vi.mocked(expiryNotice);

beforeEach(() => {
  vi.clearAllMocks();
  runTimeDomainMock.mockReturnValue("example.com");
  parseMock.mockReturnValue(expiresAt);
  noticeMock.mockReturnValue({ daysLeft: 16, notify: true });
});

test("without a run-time domain the check is unknown, naming the variable, and reads nothing", async () => {
  runTimeDomainMock.mockReturnValue(undefined);
  const read = vi.fn();

  const result = await checkDomainExpiry({
    environment: managed,
    env,
    read,
    now,
  });

  expect(result).toEqual({
    status: "unknown",
    cause: expect.stringContaining("KORE_PLATFORM_DOMAIN"),
  });
  expect(read).not.toHaveBeenCalled();
});

test("the check reads the run-time domain through the one function and hands only it to the reader", async () => {
  const read = vi.fn().mockResolvedValue("{}");

  await checkDomainExpiry({ environment: managed, env, read, now });

  expect(runTimeDomainMock).toHaveBeenCalledWith(managed, env);
  expect(read).toHaveBeenCalledWith("example.com");
});

test("a registration that is not notified is ok, with its days left", async () => {
  noticeMock.mockReturnValue({ daysLeft: 45, notify: false });
  const read = vi.fn().mockResolvedValue("{}");

  const result = await checkDomainExpiry({
    environment: managed,
    env,
    read,
    now,
  });

  expect(result).toEqual({ status: "ok", daysLeft: 45 });
});

test("a registration that expires in under thirty days is notify-only, with its days left", async () => {
  const read = vi.fn().mockResolvedValue("{}");

  const result = await checkDomainExpiry({
    environment: managed,
    env,
    read,
    now,
  });

  expect(noticeMock).toHaveBeenCalledWith(expiresAt, now);
  expect(result).toEqual({
    status: "notify",
    daysLeft: 16,
    message: expect.stringContaining("16 days"),
  });
});

test("a notify result never carries the domain value", async () => {
  const read = vi.fn().mockResolvedValue("{}");

  const result = await checkDomainExpiry({
    environment: managed,
    env,
    read,
    now,
  });

  expect(JSON.stringify(result)).not.toContain("example.com");
});

test("a malformed or missing expiry is unknown, carrying the parser's named cause", async () => {
  parseMock.mockImplementation(() => {
    throw new DomainExpiryError("the RDAP response has no expiration event");
  });
  const read = vi.fn().mockResolvedValue("{}");

  const result = await checkDomainExpiry({
    environment: managed,
    env,
    read,
    now,
  });

  expect(result).toEqual({
    status: "unknown",
    cause: "the RDAP response has no expiration event",
  });
  expect(noticeMock).not.toHaveBeenCalled();
});

test("a reader that cannot answer is unknown, carrying its named cause", async () => {
  const read = vi
    .fn()
    .mockRejectedValue(new DomainExpiryError("the RDAP server did not answer"));

  const result = await checkDomainExpiry({
    environment: managed,
    env,
    read,
    now,
  });

  expect(result).toEqual({
    status: "unknown",
    cause: "the RDAP server did not answer",
  });
});

test("an unexpected reader failure is rethrown rather than reported as a verdict", async () => {
  const read = vi.fn().mockRejectedValue(new TypeError("socket reset"));

  await expect(
    checkDomainExpiry({ environment: managed, env, read, now }),
  ).rejects.toThrow(TypeError);
});
