// Docs: docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { featureEnabled } from "../config/index.js";
import {
  ensureResolver,
  systemResolverHost,
  terminalConfirm,
} from "../resolver/index.js";
import { withHostResolver } from "./host-resolver.js";
import { fakeRepository, fakeRunner } from "./local-support.js";

vi.mock("../config/index.js");
vi.mock("../resolver/index.js");

const repository = fakeRepository();
const host = { read: vi.fn(), probe: vi.fn() };
const confirm = vi.fn(async () => true);
const resolverPath = "/etc/resolver/kore.internal";
let calls: string[];
let stderr: string[];

/** The platform-dns flag is the only flag on, or none is. */
function flagOn(on: boolean): void {
  vi.mocked(featureEnabled).mockImplementation(
    (_environment, flag) => on && flag === "platform-dns",
  );
}

const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");

function stdinIsTerminal(isTTY: boolean): void {
  Object.defineProperty(process.stdin, "isTTY", {
    value: isTTY,
    configurable: true,
  });
}

/** The cluster work the wrapper runs; it records that it ran. */
async function upWork(): Promise<string> {
  calls.push("up");
  return "done";
}

beforeEach(() => {
  calls = [];
  stderr = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
  vi.mocked(systemResolverHost).mockReturnValue(host);
  vi.mocked(terminalConfirm).mockReturnValue(confirm);
  vi.mocked(ensureResolver).mockImplementation(async () => {
    calls.push("resolver");
    return { status: "unchanged", path: resolverPath };
  });
  flagOn(true);
});

afterEach(() => {
  if (originalIsTTY === undefined) {
    Reflect.deleteProperty(process.stdin, "isTTY");
  } else {
    Object.defineProperty(process.stdin, "isTTY", originalIsTTY);
  }
  vi.restoreAllMocks();
  vi.mocked(terminalConfirm).mockReset();
});

test("with platform-dns off the work runs alone: the resolver file is neither read nor installed and nothing is printed", async () => {
  flagOn(false);
  const { runner } = fakeRunner();

  expect(await withHostResolver(repository, runner, upWork)).toBe("done");

  expect(ensureResolver).not.toHaveBeenCalled();
  expect(systemResolverHost).not.toHaveBeenCalled();
  expect(terminalConfirm).not.toHaveBeenCalled();
  expect(calls).toEqual(["up"]);
  expect(stderr).toEqual([]);
});

test("with platform-dns on the resolver file is ensured once, with the terminal confirmation, before the work", async () => {
  stdinIsTerminal(true);
  const { runner } = fakeRunner();

  expect(await withHostResolver(repository, runner, upWork)).toBe("done");

  expect(terminalConfirm).toHaveBeenCalledWith(true);
  expect(ensureResolver).toHaveBeenCalledTimes(1);
  expect(ensureResolver).toHaveBeenCalledWith(
    repository.environment,
    runner,
    host,
    { confirm },
  );
  expect(calls).toEqual(["resolver", "up"]);
  expect(stderr).toEqual([]);
});

test("with no terminal nothing is asked, the work still completes, and the next step is printed last", async () => {
  stdinIsTerminal(false);
  vi.mocked(terminalConfirm).mockReturnValue(undefined);
  vi.mocked(ensureResolver).mockResolvedValue({
    status: "skipped",
    path: resolverPath,
    next: "no terminal to ask on, so the file was not installed; run kore dns install --environment local",
  });
  const { runner } = fakeRunner();

  await withHostResolver(repository, runner, async () => {
    calls.push("up");
    expect(stderr).toEqual([]);
  });

  expect(terminalConfirm).toHaveBeenCalledWith(false);
  expect(ensureResolver).toHaveBeenCalledWith(
    repository.environment,
    runner,
    host,
    { confirm: undefined },
  );
  expect(calls).toEqual(["up"]);
  expect(stderr).toEqual([
    "next: no terminal to ask on, so the file was not installed; run kore dns install --environment local\n",
  ]);
});

test("a foreign resolver file is reported at the end and the work still completes", async () => {
  vi.mocked(ensureResolver).mockResolvedValue({
    status: "foreign",
    path: resolverPath,
    next: `${resolverPath} exists and was not written by kore, so it was left alone`,
  });
  const { runner } = fakeRunner();

  await withHostResolver(repository, runner, upWork);

  expect(calls).toEqual(["up"]);
  expect(stderr).toEqual([
    `next: ${resolverPath} exists and was not written by kore, so it was left alone\n`,
  ]);
});

test("an installed or updated resolver file is announced by name", async () => {
  vi.mocked(ensureResolver).mockResolvedValue({
    status: "updated",
    path: resolverPath,
  });
  const { runner } = fakeRunner();

  await withHostResolver(repository, runner, upWork);

  expect(stderr).toEqual([`updated the host resolver file ${resolverPath}\n`]);
});

test("a refused install fails fast with its cause, and the work never starts", async () => {
  vi.mocked(ensureResolver).mockRejectedValue(
    new Error(
      `kore dns install was not confirmed; nothing was written to ${resolverPath}`,
    ),
  );
  const { runner } = fakeRunner();

  await expect(withHostResolver(repository, runner, upWork)).rejects.toThrow(
    `kore dns install was not confirmed; nothing was written to ${resolverPath}`,
  );

  expect(calls).toEqual([]);
  expect(stderr).toEqual([]);
});

test("the terminal check is put back after each test", () => {
  expect(Object.getOwnPropertyDescriptor(process.stdin, "isTTY")).toEqual(
    originalIsTTY,
  );
});
