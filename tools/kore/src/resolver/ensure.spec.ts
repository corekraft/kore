// Docs: docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md
import { beforeEach, expect, test, vi } from "vitest";
import { ensureResolver } from "./ensure.js";
import { installResolver, resolverState, resolverTarget } from "./resolver.js";
import {
  environment,
  fakeHost,
  fakeRunner,
  target,
} from "./resolver-support.js";

vi.mock("./resolver.js");

const confirm = vi.fn(async () => true);

beforeEach(() => {
  confirm.mockClear();
  vi.mocked(resolverTarget).mockReturnValue(target);
  vi.mocked(resolverState).mockReturnValue("absent");
  vi.mocked(installResolver).mockResolvedValue({
    status: "installed",
    path: target.path,
  });
});

test("a correct resolver file is left alone: no install, no question", async () => {
  vi.mocked(resolverState).mockReturnValue("current");
  const { runner } = fakeRunner();

  const result = await ensureResolver(environment, runner, fakeHost("file"), {
    confirm,
  });

  expect(result).toEqual({ status: "unchanged", path: target.path });
  expect(installResolver).not.toHaveBeenCalled();
  expect(confirm).not.toHaveBeenCalled();
});

test("a missing file is installed once, through the install with the terminal confirmation and no --yes", async () => {
  const { runner } = fakeRunner();
  const host = fakeHost(undefined);

  const result = await ensureResolver(environment, runner, host, { confirm });

  expect(result).toEqual({ status: "installed", path: target.path });
  expect(resolverState).toHaveBeenCalledWith(target, undefined);
  expect(installResolver).toHaveBeenCalledTimes(1);
  expect(installResolver).toHaveBeenCalledWith(environment, runner, host, {
    yes: false,
    confirm,
  });
});

test("an out-of-date file is updated through the same install", async () => {
  vi.mocked(resolverState).mockReturnValue("outdated");
  vi.mocked(installResolver).mockResolvedValue({
    status: "updated",
    path: target.path,
  });
  const { runner } = fakeRunner();

  const result = await ensureResolver(environment, runner, fakeHost("old"), {
    confirm,
  });

  expect(result).toEqual({ status: "updated", path: target.path });
  expect(installResolver).toHaveBeenCalledTimes(1);
});

test("with no terminal there is no prompt and no install; the result names the next step", async () => {
  const { runner, run } = fakeRunner();

  const result = await ensureResolver(
    environment,
    runner,
    fakeHost(undefined),
    {
      confirm: undefined,
    },
  );

  expect(result).toEqual({
    status: "skipped",
    path: target.path,
    next: `no terminal to ask on, so ${target.path} was not installed; run kore dns install --environment local in a terminal to make ${target.zone} names resolve`,
  });
  expect(installResolver).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});

test("a file without the Kore marker is reported, never rewritten and never asked about", async () => {
  vi.mocked(resolverState).mockReturnValue("foreign");
  const { runner, run } = fakeRunner();

  const result = await ensureResolver(environment, runner, fakeHost("mine"), {
    confirm,
  });

  expect(result).toEqual({
    status: "foreign",
    path: target.path,
    next: `${target.path} exists and was not written by kore, so it was left alone; move it aside, then run kore dns install --environment local`,
  });
  expect(installResolver).not.toHaveBeenCalled();
  expect(confirm).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});

test("a declined or failed install fails with its cause, not a status", async () => {
  vi.mocked(installResolver).mockRejectedValue(
    new Error(
      `kore dns install was not confirmed; nothing was written to ${target.path}`,
    ),
  );
  const { runner } = fakeRunner();

  await expect(
    ensureResolver(environment, runner, fakeHost(undefined), { confirm }),
  ).rejects.toThrow(
    `kore dns install was not confirmed; nothing was written to ${target.path}`,
  );
});
