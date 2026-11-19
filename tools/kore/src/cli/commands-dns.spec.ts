// Docs: docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md
import { beforeEach, expect, test, vi } from "vitest";
import {
  installResolver,
  systemResolverHost,
  terminalConfirm,
  uninstallResolver,
} from "../resolver/index.js";
import type { ActionHandler } from "./context.js";
import { mutateAction } from "./context.js";
import { dnsCommand } from "./commands-dns.js";
import { boolFlag } from "./flags.js";
import { print } from "./output.js";
import {
  fakeContext,
  fakeRepository,
  parsedArgs,
  sharedRunner,
} from "./cli-support.js";

vi.mock("../resolver/index.js");
vi.mock("./context.js");
vi.mock("./flags.js");
vi.mock("./output.js");

const repository = fakeRepository({ name: "local" });
const runner = sharedRunner;

/** The action table the last mutation was given. */
function actionsOf(): Record<string, ActionHandler> {
  return vi.mocked(mutateAction).mock.calls.at(-1)![1];
}

beforeEach(() => {
  vi.mocked(mutateAction).mockResolvedValue(0);
  vi.mocked(boolFlag).mockReturnValue(false);
  vi.mocked(systemResolverHost).mockReturnValue({} as never);
  vi.mocked(terminalConfirm).mockReturnValue(undefined);
});

test("dns install writes the environment's resolver file under the lock, passing --yes, and prints the result", async () => {
  vi.mocked(boolFlag).mockImplementation((_parsed, name) => name === "yes");
  vi.mocked(installResolver).mockResolvedValue({
    status: "installed",
    path: "/etc/resolver/kore.internal",
  });
  const context = fakeContext({
    command: "dns",
    action: "install",
    repository,
    json: true,
    parsed: parsedArgs(),
  });

  expect(await dnsCommand(context)).toBe(0);
  await actionsOf().install!(context, runner);

  expect(installResolver).toHaveBeenCalledWith(
    repository.environment,
    runner,
    expect.anything(),
    expect.objectContaining({ yes: true }),
  );
  expect(print).toHaveBeenCalledWith(
    { status: "installed", path: "/etc/resolver/kore.internal" },
    true,
  );
});

test("dns uninstall removes only the environment's Kore resolver file and prints the result", async () => {
  vi.mocked(uninstallResolver).mockResolvedValue({
    status: "absent",
    path: "/etc/resolver/kore.internal",
  });
  const context = fakeContext({
    command: "dns",
    action: "uninstall",
    repository,
    parsed: parsedArgs(),
  });

  expect(await dnsCommand(context)).toBe(0);
  await actionsOf().uninstall!(context, runner);

  expect(uninstallResolver).toHaveBeenCalledWith(
    repository.environment,
    runner,
    expect.anything(),
    expect.objectContaining({ yes: false }),
  );
  expect(print).toHaveBeenCalledWith(
    { status: "absent", path: "/etc/resolver/kore.internal" },
    false,
  );
});

test("dns asks on the terminal only when one is attached, and otherwise needs --yes", async () => {
  const confirm = vi.fn(async () => true);
  vi.mocked(terminalConfirm).mockReturnValue(confirm);
  const context = fakeContext({
    command: "dns",
    action: "install",
    repository,
    parsed: parsedArgs(),
  });

  await dnsCommand(context);
  await actionsOf().install!(context, runner);

  expect(terminalConfirm).toHaveBeenCalledWith(Boolean(process.stdin.isTTY));
  expect(installResolver).toHaveBeenCalledWith(
    repository.environment,
    runner,
    expect.anything(),
    expect.objectContaining({ confirm }),
  );
});

test("dns with no action, or an action it does not have, refuses before any lock is taken", async () => {
  for (const action of [undefined, "status"]) {
    const context = fakeContext({
      command: "dns",
      action,
      repository,
      parsed: parsedArgs(),
    });

    await expect(dnsCommand(context)).rejects.toThrow(
      "kore dns needs an action: install or uninstall, for example kore dns install --environment local",
    );
  }
  expect(mutateAction).not.toHaveBeenCalled();
});
