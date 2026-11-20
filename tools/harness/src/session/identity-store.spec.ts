import { beforeEach, describe, expect, it } from "vitest";
import { fakeDeps, type FakeDeps } from "./deps-support.js";
import { identityItem } from "./identity-store.js";

const WIZARD = "tools/harness/wizards/identities.sh";
const STORE = "/home/agent/.config/kore/identities.sops.json";
const AGE_KEY = "/home/agent/.config/sops/age/keys.txt";
const TRANSFER = `From the Mac, run \`bash ${WIZARD} --transfer <user@host>\`, then rerun.`;
const ITEM = "kore.reviewer.app-id";

let deps: FakeDeps;

/** The error for an item sops could not hand back. */
const unreadable = (identity: string, item: string): string =>
  `The ${identity} identity is missing: item ${item} could not be read from ${STORE} (it is absent, or sops could not decrypt it with the age key ${AGE_KEY}). ${TRANSFER} No pane was split.`;

beforeEach(() => {
  deps = fakeDeps();
});

describe("identityItem on macOS reads the keychain", () => {
  it("returns the item's value from `security find-generic-password`, trimmed, without touching the file system", async () => {
    deps.runner.run.mockResolvedValue({
      stdout: "55555\n",
      stderr: "",
      code: 0,
    });

    await expect(identityItem(deps, ITEM, "reviewer")).resolves.toEqual({
      token: "55555",
    });
    expect(deps.runner.run).toHaveBeenCalledExactlyOnceWith("security", [
      "find-generic-password",
      "-s",
      ITEM,
      "-a",
      "kore",
      "-w",
    ]);
    expect(deps.fs.exists).not.toHaveBeenCalled();
  });

  it("refuses, naming the item and the wizard, when the keychain has no such item", async () => {
    deps.runner.run.mockResolvedValue({ stdout: "", stderr: "", code: 44 });

    await expect(identityItem(deps, ITEM, "reviewer")).resolves.toEqual({
      error: `The reviewer identity is missing: keychain item ${ITEM} was not found. Create it with \`bash ${WIZARD}\`, then rerun. No pane was split.`,
    });
  });

  it("reads the keychain when the host is darwin, too", async () => {
    deps.platform = "darwin";
    deps.runner.run.mockResolvedValue({
      stdout: "55555\n",
      stderr: "",
      code: 0,
    });

    await identityItem(deps, ITEM, "reviewer");

    expect(deps.runner.run.mock.calls[0]?.[0]).toBe("security");
  });
});

describe("identityItem on Linux reads the sops store", () => {
  beforeEach(() => {
    deps.platform = "linux";
    deps.env["HOME"] = "/home/agent";
    deps.fs.exists.mockResolvedValue(true);
    deps.runner.run.mockResolvedValue({
      stdout: "55555",
      stderr: "",
      code: 0,
    });
  });

  it("extracts one key per call with sops decrypt, and never asks the keychain", async () => {
    await expect(identityItem(deps, ITEM, "reviewer")).resolves.toEqual({
      token: "55555",
    });

    expect(deps.fs.exists).toHaveBeenCalledWith(STORE);
    expect(deps.runner.run).toHaveBeenCalledExactlyOnceWith("sops", [
      "decrypt",
      "--extract",
      '["kore.reviewer.app-id"]',
      STORE,
    ]);
  });

  it("refuses, naming the store file and the transfer step, when the file is missing, and runs no sops", async () => {
    deps.fs.exists.mockResolvedValue(false);

    await expect(identityItem(deps, ITEM, "reviewer")).resolves.toEqual({
      error: `The reviewer identity is missing: the identity store ${STORE} was not found. ${TRANSFER} No pane was split.`,
    });
    expect(deps.runner.run).not.toHaveBeenCalled();
  });

  it("refuses, naming the item, the store and the age key, when sops finds no such key", async () => {
    deps.runner.run.mockResolvedValue({
      stdout: "",
      stderr: `Error extracting path ${ITEM}`,
      code: 1,
    });

    await expect(identityItem(deps, ITEM, "reviewer")).resolves.toEqual({
      error: unreadable("reviewer", ITEM),
    });
  });

  it("refuses the same way when sops itself fails, and never echoes its output", async () => {
    deps.runner.run.mockResolvedValue({
      stdout: "SECRET_VALUE_ON_STDOUT",
      stderr: "SECRET_VALUE_ON_STDERR",
      code: 128,
    });

    const result = await identityItem(deps, ITEM, "reviewer");

    expect(result).toEqual({ error: unreadable("reviewer", ITEM) });
    expect(JSON.stringify(result)).not.toContain("SECRET_VALUE");
  });

  it("refuses a value sops returns empty, as a missing one", async () => {
    deps.runner.run.mockResolvedValue({ stdout: "  \n", stderr: "", code: 0 });

    await expect(identityItem(deps, ITEM, "reviewer")).resolves.toEqual({
      error: unreadable("reviewer", ITEM),
    });
  });

  it("refuses, naming HOME, when the home directory is unknown, and runs nothing", async () => {
    delete deps.env["HOME"];

    await expect(identityItem(deps, ITEM, "reviewer")).resolves.toEqual({
      error: `The reviewer identity is missing: HOME is not set, so the identity store ~/.config/kore/identities.sops.json cannot be found. Set HOME, then rerun. No pane was split.`,
    });
    expect(deps.fs.exists).not.toHaveBeenCalled();
    expect(deps.runner.run).not.toHaveBeenCalled();
  });
});
