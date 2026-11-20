import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  PAT,
  read,
  removeScratch,
  runWizard,
  sandbox,
  type Sandbox,
} from "./identities-wizard-support.js";

afterEach(removeScratch);

const HOST = "agent@kore-agents";
const APP_KEY = Buffer.from("-----BEGIN PRIVATE KEY-----\nMIIfake\n").toString(
  "base64",
);

/** The keychain holds the reviewer App and the judge PAT; values are the secrets the wizard must never show. */
const ITEMS: Record<string, string> = {
  "kore.reviewer.app-id": "55555",
  "kore.reviewer.installation-id": "9001",
  "kore.reviewer.private-key": APP_KEY,
  "kore.judge.pat": PAT,
};

function stock(box: Sandbox, items: Record<string, string>): void {
  writeFileSync(
    box.values,
    Object.entries(items)
      .map(([item, value]) => `${item}=${value}`)
      .join("\n") + "\n",
  );
}

/** Answers for a transfer: ready to start, then the confirmation to send. */
const YES = "\ny\n";

describe("identities wizard --transfer arguments", () => {
  it("in a dry run reads, asks and sends nothing, and says what it would do", () => {
    const box = sandbox();
    const result = runWizard(box, ["--transfer", HOST, "--dry-run"], "");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`would send the identities to ${HOST}`);
    expect(existsSync(box.calls)).toBe(false);
    expect(readdirSync(box.cwd)).toEqual([]);
    expect(readdirSync(box.home)).toEqual([]);
  });

  it("refuses a missing host with usage and runs nothing", () => {
    const box = sandbox();
    const result = runWizard(box, ["--transfer"], "");

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--transfer needs a host");
    expect(result.stderr).toContain(
      "Usage: identities.sh [--dry-run] [--transfer <user@host>]",
    );
    expect(existsSync(box.calls)).toBe(false);
  });

  it("refuses a host that ssh would read as an option", () => {
    const box = sandbox();
    const result = runWizard(box, ["--transfer", "-oProxyCommand=x"], "");

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("-oProxyCommand=x");
    expect(existsSync(box.calls)).toBe(false);
  });
});

describe("identities wizard --transfer sends the keychain, encrypted", () => {
  it("streams the keychain values over ssh stdin into sops encrypt, against the host's age public key", () => {
    const box = sandbox();
    stock(box, ITEMS);

    const result = runWizard(box, ["--transfer", HOST], YES);

    expect(result.status).toBe(0);
    const ssh = read(box.calls)
      .split("\n")
      .filter((line) => line.startsWith("ssh "));
    expect(ssh).toHaveLength(2);
    expect(ssh[0]).toBe(
      'ssh -- agent@kore-agents age-keygen -y "$HOME/.config/sops/age/keys.txt"',
    );
    expect(ssh[1]).toContain("-- agent@kore-agents");
    expect(ssh[1]).toContain(
      "sops --config /dev/null encrypt --age age1hostpublickeyfortests",
    );
    expect(ssh[1]).toContain("--input-type json --output-type json /dev/stdin");
    expect(ssh[1]).toContain(".config/kore/identities.sops.json");
    expect(JSON.parse(read(box.sshStdin))).toEqual(ITEMS);
  });

  it("puts no secret in argv, in the output or on either disk", () => {
    const box = sandbox();
    stock(box, ITEMS);

    const result = runWizard(box, ["--transfer", HOST], YES);

    const shown = `${result.stdout}${result.stderr}${read(box.calls)}`;
    for (const value of Object.values(ITEMS)) {
      expect(shown).not.toContain(value);
    }
    expect(read(box.securityStdin)).toBe("");
    expect(readdirSync(box.cwd)).toEqual([]);
    expect(readdirSync(box.home)).toEqual([]);
  });
});

describe("identities wizard --transfer with several age keys on the host", () => {
  it("encrypts to every key the host reports, comma-joined", () => {
    const box = sandbox();
    stock(box, ITEMS);
    writeFileSync(
      `${box.bin}/ssh`,
      `#!/bin/sh\necho "ssh $*" >> "${box.calls}"\ncase "$*" in *age-keygen*) printf 'age1firstkey\\nage1secondkey\\n';; *) cat >> "${box.sshStdin}";; esac\n`,
    );

    const result = runWizard(box, ["--transfer", HOST], YES);

    expect(result.status).toBe(0);
    expect(read(box.calls)).toContain(
      "sops --config /dev/null encrypt --age age1firstkey,age1secondkey --input-type json",
    );
    expect(JSON.parse(read(box.sshStdin))).toEqual(ITEMS);
  });

  it("exits 1 and sends nothing when ssh answers with an error message", () => {
    const box = sandbox();
    stock(box, ITEMS);
    writeFileSync(
      `${box.bin}/ssh`,
      `#!/bin/sh\ncase "$*" in *age-keygen*) echo 'age-keygen: command not found';; *) cat >> "${box.sshStdin}";; esac\n`,
    );

    const result = runWizard(box, ["--transfer", HOST], YES);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(HOST);
    expect(read(box.sshStdin)).toBe("");
  });
});

describe("identities wizard --transfer stops before it sends", () => {
  it("sends only the items the keychain holds and names the ones it lacks", () => {
    const box = sandbox();
    stock(box, { "kore.judge.pat": PAT });

    const result = runWizard(box, ["--transfer", HOST], YES);

    expect(result.status).toBe(0);
    expect(JSON.parse(read(box.sshStdin))).toEqual({ "kore.judge.pat": PAT });
    expect(result.stdout).toContain(
      "kore.writer.app-id is not in the keychain",
    );
  });

  it("stops without calling ssh when the keychain holds no identity", () => {
    const box = sandbox();

    const result = runWizard(box, ["--transfer", HOST], YES);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("no identity in the keychain");
    expect(read(box.calls)).not.toContain("ssh");
  });

  it("refuses a value that is not safe to place in the JSON, and sends nothing", () => {
    const box = sandbox();
    stock(box, { ...ITEMS, "kore.judge.pat": 'bad"value' });

    const result = runWizard(box, ["--transfer", HOST], YES);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("kore.judge.pat holds a character");
    expect(`${result.stdout}${result.stderr}`).not.toContain('bad"value');
    expect(read(box.sshStdin)).toBe("");
  });

  it("stops and names the host when it has no age key", () => {
    const box = sandbox();
    stock(box, ITEMS);
    writeFileSync(`${box.bin}/ssh`, "#!/bin/sh\nexit 255\n");

    const result = runWizard(box, ["--transfer", HOST], YES);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain(`${HOST}`);
    expect(result.stdout).toContain(
      "age-keygen -o ~/.config/sops/age/keys.txt",
    );
    expect(read(box.sshStdin)).toBe("");
  });

  it("sends nothing when you decline at the confirmation", () => {
    const box = sandbox();
    stock(box, ITEMS);

    const result = runWizard(box, ["--transfer", HOST], "\nn\n");

    expect(result.status).not.toBe(0);
    expect(read(box.sshStdin)).toBe("");
  });
});
