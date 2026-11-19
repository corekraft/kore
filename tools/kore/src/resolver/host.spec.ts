// Docs: docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md
import { Resolver } from "node:dns/promises";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { beforeEach, expect, test, vi } from "vitest";
import {
  probeDns,
  readResolverFile,
  systemResolverHost,
  terminalConfirm,
} from "./host.js";

// The host adapter is the one place that touches the filesystem, DNS and the
// terminal; the unit takes each as a fake.
vi.mock("node:fs/promises");
vi.mock("node:dns/promises", () => ({ Resolver: vi.fn() }));
vi.mock("node:readline/promises", () => ({ createInterface: vi.fn() }));

const zonePath = "/etc/resolver/kore.internal";

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

beforeEach(() => {
  vi.resetAllMocks();
});

test("readResolverFile returns the file's text, read as UTF-8 from its path", async () => {
  vi.mocked(readFile).mockResolvedValue("nameserver 127.0.0.1\n");

  await expect(readResolverFile(zonePath)).resolves.toBe(
    "nameserver 127.0.0.1\n",
  );
  expect(readFile).toHaveBeenCalledWith(zonePath, "utf8");
});

test("readResolverFile reports a missing file as undefined rather than an error", async () => {
  vi.mocked(readFile).mockRejectedValue(errno("ENOENT"));

  await expect(readResolverFile(zonePath)).resolves.toBeUndefined();
});

test("readResolverFile rethrows a read failure other than a missing file", async () => {
  vi.mocked(readFile).mockRejectedValue(errno("EACCES"));

  await expect(readResolverFile(zonePath)).rejects.toThrow("EACCES");
});

test("probeDns asks only the platform DNS server and returns the addresses it answers", async () => {
  const setServers = vi.fn();
  const resolve4 = vi.fn(async () => ["127.0.0.1"]);
  // A constructor, so `new Resolver()` in the unit gets this instance.
  vi.mocked(Resolver).mockImplementation(function () {
    return { setServers, resolve4 } as unknown as Resolver;
  } as unknown as typeof Resolver);

  await expect(
    probeDns("platform.kore.internal", { address: "127.0.0.1", port: 1053 }),
  ).resolves.toEqual(["127.0.0.1"]);
  expect(setServers).toHaveBeenCalledWith(["127.0.0.1:1053"]);
  expect(resolve4).toHaveBeenCalledWith("platform.kore.internal");
});

test("terminalConfirm offers no prompt without a terminal, so the caller must pass --yes", () => {
  expect(terminalConfirm(false)).toBeUndefined();
});

test("terminalConfirm answers yes for y or yes, and no for anything else", async () => {
  const question = vi.fn();
  const close = vi.fn();
  vi.mocked(createInterface).mockReturnValue({
    question,
    close,
  } as unknown as ReturnType<typeof createInterface>);
  const ask = terminalConfirm(true);
  expect(ask).toBeDefined();

  question.mockResolvedValueOnce("y");
  await expect(ask!("Continue? [y/N] ")).resolves.toBe(true);
  question.mockResolvedValueOnce("Yes");
  await expect(ask!("Continue? [y/N] ")).resolves.toBe(true);
  question.mockResolvedValueOnce("");
  await expect(ask!("Continue? [y/N] ")).resolves.toBe(false);
  question.mockResolvedValueOnce("n");
  await expect(ask!("Continue? [y/N] ")).resolves.toBe(false);
  expect(question).toHaveBeenCalledWith("Continue? [y/N] ");
  expect(close).toHaveBeenCalledTimes(4);
});

test("systemResolverHost reads the resolver file and probes through the host functions", () => {
  const host = systemResolverHost();

  expect(typeof host.read).toBe("function");
  expect(typeof host.probe).toBe("function");
});
