import type { CliDeps } from "../runtime/index.js";

/** Where the owner runs the wizard that creates the identities and fills the keychain or the Linux store. */
export const WIZARD = "tools/harness/wizards/identities.sh";

const ACCOUNT = "kore";

export type RoleToken = { token: string } | { error: string };

/** The wizard step that fills the Linux identity store from the Mac keychain. */
const TRANSFER_STEP = `bash ${WIZARD} --transfer <user@host>`;

/** Where a Linux host keeps its identities, encrypted to its own age key, and the age key sops reads. */
const STORE_RELATIVE = ".config/kore/identities.sops.json";
const AGE_KEY_RELATIVE = ".config/sops/age/keys.txt";

/** A non-empty value as a token, or undefined when the read failed or came back empty. */
const valueOf = (read: {
  stdout: string;
  code: number;
}): RoleToken | undefined => {
  const value = read.stdout.trim();
  return read.code === 0 && value !== "" ? { token: value } : undefined;
};

/** The macOS keychain item's value; an error naming the item and the wizard when it is missing or empty. */
async function fromMacKeychain(
  deps: CliDeps,
  service: string,
  identity: string,
): Promise<RoleToken> {
  const read = await deps.runner.run("security", [
    "find-generic-password",
    "-s",
    service,
    "-a",
    ACCOUNT,
    "-w",
  ]);
  return (
    valueOf(read) ?? {
      error: `The ${identity} identity is missing: keychain item ${service} was not found. Create it with \`bash ${WIZARD}\`, then rerun. No pane was split.`,
    }
  );
}

/**
 * The item's value from the host's sops-encrypted identity store, one key per
 * call through `sops decrypt --extract`, so the value is never written to disk
 * or argv. The error names the item, the store and the transfer step, and never
 * echoes sops's output.
 */
async function fromSopsStore(
  deps: CliDeps,
  item: string,
  identity: string,
): Promise<RoleToken> {
  const home = deps.env["HOME"];
  if (home === undefined || home === "") {
    return {
      error: `The ${identity} identity is missing: HOME is not set, so the identity store ~/${STORE_RELATIVE} cannot be found. Set HOME, then rerun. No pane was split.`,
    };
  }
  const store = `${home}/${STORE_RELATIVE}`;
  if (!(await deps.fs.exists(store))) {
    return {
      error: `The ${identity} identity is missing: the identity store ${store} was not found. From the Mac, run \`${TRANSFER_STEP}\`, then rerun. No pane was split.`,
    };
  }
  const read = await deps.runner.run("sops", [
    "decrypt",
    "--extract",
    JSON.stringify([item]),
    store,
  ]);
  return (
    valueOf(read) ?? {
      error: `The ${identity} identity is missing: item ${item} could not be read from ${store} (it is absent, or sops could not decrypt it with the age key ${home}/${AGE_KEY_RELATIVE}). From the Mac, run \`${TRANSFER_STEP}\`, then rerun. No pane was split.`,
    }
  );
}

/** An identity item's value: the sops store on Linux, the keychain on macOS (and in fakes without a platform). */
export const identityItem = (
  deps: CliDeps,
  item: string,
  identity: string,
): Promise<RoleToken> =>
  deps.platform === "linux"
    ? fromSopsStore(deps, item, identity)
    : fromMacKeychain(deps, item, identity);
