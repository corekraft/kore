import { readFile } from "node:fs/promises";
import { beforeEach, expect, test, vi } from "vitest";
import {
  rotateRegistryCredentials,
  swapLocalSigningKey,
} from "../images/index.js";
import { localDown, localUp, withHostResolver } from "../local/index.js";
import {
  applySmtpCredentials,
  installLocalTrust,
  parseSmtpCredentials,
  syncLocalSecrets,
  trustIssuer,
} from "../security/index.js";
import type { ActionHandler } from "./context.js";
import { mutateAction } from "./context.js";
import { boolFlag } from "./flags.js";
import {
  composeLocalDelivery,
  fetchChartLock,
  lockCheck,
} from "./local-chart-lock.js";
import { print } from "./output.js";
import {
  localCommand,
  registryCommand,
  secretsCommand,
  signerCommand,
  trustCommand,
} from "./commands-local.js";
import {
  fakeContext,
  fakeRepository,
  parsedArgs,
  sharedRunner,
} from "./cli-support.js";

vi.mock("node:fs/promises");
vi.mock("../images/index.js");
vi.mock("../local/index.js");
vi.mock("../platform/index.js");
vi.mock("../security/index.js");
vi.mock("./context.js");
vi.mock("./flags.js");
vi.mock("./local-chart-lock.js");
vi.mock("./output.js");

const repository = fakeRepository({ gateway: { name: "kore-gateway" } });
const runner = sharedRunner;
const chartsComposed = fakeRepository({ gateway: { name: "charts" } });

/** The action table the last mutation was given. */
function actionsOf(): Record<string, ActionHandler> {
  return vi.mocked(mutateAction).mock.calls.at(-1)![1];
}

/** Standalone flags that are set; every other flag is unset. */
function setFlags(...names: string[]): void {
  vi.mocked(boolFlag).mockImplementation((_parsed, name) =>
    names.includes(name),
  );
}

beforeEach(() => {
  setFlags();
  vi.mocked(mutateAction).mockResolvedValue(0);
  vi.mocked(withHostResolver).mockImplementation(
    async (_repository, _runner, work) => await work(),
  );
  vi.mocked(syncLocalSecrets).mockResolvedValue(2);
});

test("local up and down run as mutations, with down's prune, purge and force options", async () => {
  setFlags("prune", "force");
  const context = fakeContext({
    command: "local",
    action: "down",
    repository,
    parsed: parsedArgs(),
  });
  const delivered = fakeRepository({ gateway: { name: "delivered" } });
  vi.mocked(composeLocalDelivery).mockResolvedValue(delivered);
  expect(await localCommand(context)).toBe(0);
  await actionsOf().up!(context, runner);
  expect(composeLocalDelivery).toHaveBeenCalledWith(context, runner);
  await actionsOf().down!(context, runner);
  expect(withHostResolver).toHaveBeenCalledWith(
    delivered,
    runner,
    expect.any(Function),
  );
  expect(localUp).toHaveBeenCalledWith(delivered, runner);
  expect(localDown).toHaveBeenCalledWith(repository, runner, {
    prune: true,
    purgeData: false,
    force: true,
  });
});

test("secrets sync syncs the local secrets without rotating them, and reports how many files it synced", async () => {
  const context = fakeContext({
    command: "secrets",
    action: "sync",
    repository,
    json: true,
  });
  expect(await secretsCommand(context)).toBe(0);
  expect(context.mutate).toHaveBeenCalledWith(
    "secrets sync",
    expect.any(Function),
  );
  expect(syncLocalSecrets).toHaveBeenCalledWith(repository, runner, {
    rotate: false,
    yes: false,
  });
  expect(print).toHaveBeenCalledWith({ status: "synced", files: 2 }, true);
});

test("secrets sync --rotate rotates the secrets with --yes, and says to restart the consumers", async () => {
  setFlags("rotate", "yes");
  const context = fakeContext({
    command: "secrets",
    action: "sync",
    repository,
  });
  await secretsCommand(context);
  expect(syncLocalSecrets).toHaveBeenCalledWith(repository, runner, {
    rotate: true,
    yes: true,
  });
  expect(print).toHaveBeenCalledWith(
    {
      status: "rotated",
      files: 2,
      next: "run kore local up to restart the consumers onto the new token",
    },
    false,
  );
});

test("trust install installs local trust and reports the gateway as the issuer", async () => {
  vi.mocked(trustIssuer).mockReturnValue("kore-gateway");
  const context = fakeContext({
    command: "trust",
    action: "install",
    repository,
  });
  expect(await trustCommand(context)).toBe(0);
  expect(context.mutate).toHaveBeenCalledWith(
    "trust install",
    expect.any(Function),
  );
  expect(installLocalTrust).toHaveBeenCalledWith(repository, runner);
  expect(print).toHaveBeenCalledWith(
    { status: "installed", issuer: "kore-gateway" },
    false,
  );
});

test("signer swap-key swaps the local signing key with --yes, and reports the swap", async () => {
  setFlags("yes");
  const context = fakeContext({
    command: "signer",
    action: "swap-key",
    repository,
    json: true,
  });
  expect(await signerCommand(context)).toBe(0);
  await actionsOf()["swap-key"]!(context, runner);
  expect(swapLocalSigningKey).toHaveBeenCalledWith(repository, runner, {
    yes: true,
  });
  expect(print).toHaveBeenCalledWith({ status: "swapped" }, true);
});

test("registry rotate-credentials reports the rotation's namespaces beside its status", async () => {
  vi.mocked(rotateRegistryCredentials).mockResolvedValue({
    namespaces: ["reference"],
  } as never);
  const context = fakeContext({
    command: "registry",
    action: "rotate-credentials",
    repository,
  });
  expect(await registryCommand(context)).toBe(0);
  await actionsOf()["rotate-credentials"]!(context, runner);
  expect(rotateRegistryCredentials).toHaveBeenCalledWith(repository, runner, {
    yes: false,
  });
  expect(print).toHaveBeenCalledWith(
    { status: "rotated", namespaces: ["reference"] },
    false,
  );
});

test("secrets smtp reads the login from stdin and applies it as a mutation, without syncing and without printing the password", async () => {
  vi.mocked(readFile).mockResolvedValue("stdin-json");
  vi.mocked(parseSmtpCredentials).mockReturnValue({
    user: "u",
    password: "p4ss",
  });
  const context = fakeContext({
    command: "secrets",
    action: "smtp",
    repository,
    json: true,
  });
  expect(await secretsCommand(context)).toBe(0);
  expect(context.mutate).toHaveBeenCalledWith(
    "secrets smtp",
    expect.any(Function),
  );
  expect(readFile).toHaveBeenCalledWith("/dev/stdin", "utf8");
  expect(parseSmtpCredentials).toHaveBeenCalledWith("stdin-json");
  expect(applySmtpCredentials).toHaveBeenCalledWith(repository, runner, {
    user: "u",
    password: "p4ss",
  });
  expect(syncLocalSecrets).not.toHaveBeenCalled();
  expect(print).toHaveBeenCalledWith(
    { status: "applied", secret: "grafana-smtp" },
    true,
  );
});

test("local up ensures the host resolver only after both locks are composed, and local down never does", async () => {
  const context = fakeContext({
    command: "local",
    action: "up",
    repository,
    parsed: parsedArgs(),
  });
  const order: string[] = [];
  vi.mocked(composeLocalDelivery).mockImplementation(async () => {
    order.push("locks");
    return chartsComposed;
  });
  vi.mocked(withHostResolver).mockImplementation(
    async (_repository, _runner, work) => {
      order.push("resolver");
      return await work();
    },
  );
  vi.mocked(localUp).mockImplementation(async () => {
    order.push("up");
  });
  await localCommand(context);
  await actionsOf().up!(context, runner);
  expect(order).toEqual(["locks", "resolver", "up"]);

  await actionsOf().down!(context, runner);
  expect(withHostResolver).toHaveBeenCalledTimes(1);
});

test("local up stops when the locks are refused, before the host resolver or any cluster work", async () => {
  const context = fakeContext({ command: "local", action: "up", repository });
  vi.mocked(composeLocalDelivery).mockRejectedValue(new Error("drift"));
  await localCommand(context);
  await expect(actionsOf().up!(context, runner)).rejects.toThrow("drift");
  expect(withHostResolver).not.toHaveBeenCalled();
  expect(localUp).not.toHaveBeenCalled();
});

test("local lock-check is read-only: it returns the check's exit code without the environment lock or journal", async () => {
  const context = fakeContext({
    command: "local",
    action: "lock-check",
    repository,
  });
  vi.mocked(lockCheck).mockResolvedValue(1);
  expect(await localCommand(context)).toBe(1);
  expect(lockCheck).toHaveBeenCalledWith(context);
  expect(mutateAction).not.toHaveBeenCalled();
  expect(context.mutate).not.toHaveBeenCalled();
});

test("local fetch-lock is read-only: it returns the fetch's exit code without the environment lock or journal", async () => {
  const context = fakeContext({
    command: "local",
    action: "fetch-lock",
    repository,
  });
  vi.mocked(fetchChartLock).mockResolvedValue(0);
  expect(await localCommand(context)).toBe(0);
  expect(fetchChartLock).toHaveBeenCalledWith(context);
  expect(mutateAction).not.toHaveBeenCalled();
  expect(context.mutate).not.toHaveBeenCalled();
});
