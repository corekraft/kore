import { beforeEach, expect, test, vi } from "vitest";
import {
  rotateRegistryCredentials,
  swapLocalSigningKey,
} from "../images/index.js";
import { localDown, localUp } from "../local/index.js";
import { installLocalTrust, syncLocalSecrets } from "../security/index.js";
import type { ActionHandler } from "./context.js";
import { mutateAction } from "./context.js";
import { boolFlag } from "./flags.js";
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

vi.mock("../images/index.js");
vi.mock("../local/index.js");
vi.mock("../security/index.js");
vi.mock("./context.js");
vi.mock("./flags.js");
vi.mock("./output.js");

const repository = fakeRepository({ gateway: { name: "kore-gateway" } });
const runner = sharedRunner;

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
  expect(await localCommand(context)).toBe(0);
  await actionsOf().up!(context, runner);
  await actionsOf().down!(context, runner);
  expect(localUp).toHaveBeenCalledWith(repository, runner);
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
