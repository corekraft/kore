import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const WIZARD = resolve(import.meta.dirname, "..", "wizards", "cloudflare.sh");
const DOCUMENTS = join("infra", "environments", "vps", "secrets");
const EXTERNAL_DOCUMENT = "cloudflare-external-dns.enc.yaml";
const ACME_DOCUMENT = "cloudflare-acme-dns01.enc.yaml";
const CIPHERTEXT = "sops-ciphertext-for-tests\n";
// Fake token values: the wizard must never print them, pass them in argv, or write them to disk.
const EXTERNAL_TOKEN = "cf_external_dns_test_token";
const ACME_TOKEN = "cf_acme_dns01_test_token";

const scratch: string[] = [];

afterEach(() => {
  for (const dir of scratch.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

interface Sandbox {
  bin: string;
  home: string;
  /** Where the wizard runs: the repository root in a real run. */
  cwd: string;
  /** One line per outside command the wizard ran: `name args`. */
  calls: string;
  /** What sops received on stdin, one encryption after another. */
  sopsStdin: string;
}

interface SandboxOptions {
  /** A repository root holds .sops.yaml and the vps secrets directory. */
  repo?: boolean;
  /** The owner's age key for the vps environment is present. */
  ageKey?: boolean;
  /** Documents already in the secrets directory, by file name. */
  existing?: Record<string, string>;
}

/** Shims for every outside tool: they log what they were given and touch nothing real. */
function sandbox(options: SandboxOptions = {}): Sandbox {
  const { repo = true, ageKey = true, existing = {} } = options;
  const root = mkdtempSync(join(tmpdir(), "kore-cloudflare-wizard-"));
  scratch.push(root);
  const bin = join(root, "bin");
  const home = join(root, "home");
  const cwd = join(root, "cwd");
  for (const dir of [bin, home, cwd]) {
    mkdirSync(dir, { recursive: true });
  }
  if (repo) {
    writeFileSync(join(cwd, ".sops.yaml"), "creation_rules: []\n");
    mkdirSync(join(cwd, DOCUMENTS), { recursive: true });
    for (const [name, text] of Object.entries(existing)) {
      writeFileSync(join(cwd, DOCUMENTS, name), text);
    }
  }
  if (ageKey) {
    const keyDir = join(home, ".config", "sops", "age");
    mkdirSync(keyDir, { recursive: true });
    writeFileSync(join(keyDir, "kore-vps.txt"), "AGE-SECRET-KEY-TEST\n");
  }
  const calls = join(root, "calls.log");
  const sopsStdin = join(root, "sops-stdin.log");
  const shim = (name: string, body: string) => {
    const path = join(bin, name);
    writeFileSync(
      path,
      `#!/bin/sh\necho "${name} $*" >> "${calls}"\n${body}\n`,
    );
    chmodSync(path, 0o755);
  };
  // sops encrypts: it reads the plaintext on stdin and answers with ciphertext only.
  shim(
    "sops",
    `if [ "$1" = --encrypt ]; then cat >> "${sopsStdin}"; printf '${CIPHERTEXT.replace("\n", "\\n")}'; exit 0; fi; exit 1`,
  );
  shim("kubectl", "exit 0");
  for (const opener of ["open", "xdg-open", "wslview", "explorer.exe"]) {
    shim(opener, "exit 0");
  }
  return { bin, home, cwd, calls, sopsStdin };
}

function runWizard(box: Sandbox, args: string[], input: string) {
  return spawnSync("bash", [WIZARD, ...args], {
    cwd: box.cwd,
    input,
    encoding: "utf8",
    env: {
      PATH: `${box.bin}:/usr/bin:/bin`,
      HOME: box.home,
      TERM: "dumb",
    },
  });
}

function read(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

/** Every regular file under a directory, by path. */
function filesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      found.push(...filesUnder(path));
    } else {
      found.push(path);
    }
  }
  return found.sort();
}

/**
 * Every answer a full run gives, in order: the ready check, the domain, the
 * registrar settings, the OpenTofu token, then each in-cluster token and its store.
 */
function fullRun(): string[] {
  return [
    "", // ready to start
    "y", // ready check
    "y", // the domain is registered
    "y", // registrar lock, auto-renew and two-factor are on
    "y", // the OpenTofu token is made and kept
    EXTERNAL_TOKEN,
    "y", // encrypt the external-dns token
    ACME_TOKEN,
    "y", // encrypt the acme-dns01 token
  ];
}

describe("cloudflare wizard dry run", () => {
  it("walks every stage and creates nothing", () => {
    const box = sandbox();
    const before = filesUnder(box.cwd);
    const result = runWizard(box, ["--dry-run"], "");
    expect(result.status).toBe(0);
    for (const n of [1, 2, 3, 4, 5, 6]) {
      expect(result.stdout).toContain(`Stage ${n}/6`);
    }
    expect(result.stdout).toContain("Setup complete");
    // No outside tool ran, and no file was created or changed.
    expect(existsSync(box.calls)).toBe(false);
    expect(filesUnder(box.cwd)).toEqual(before);
  });

  it("says what it would encrypt for each in-cluster token, without a prompt waiting", () => {
    const out = runWizard(sandbox(), ["--dry-run"], "").stdout;
    expect(out).toContain(
      `would encrypt the external-dns token into ${join(DOCUMENTS, EXTERNAL_DOCUMENT)}`,
    );
    expect(out).toContain(
      `would encrypt the acme-dns01 token into ${join(DOCUMENTS, ACME_DOCUMENT)}`,
    );
  });

  it("refuses an option it does not know", () => {
    const result = runWizard(sandbox(), ["--wet"], "");
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--wet");
  });
});

describe("cloudflare wizard preconditions", () => {
  it("refuses to run outside the repository root", () => {
    const box = sandbox({ repo: false });
    const result = runWizard(box, [], "\n");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("repository root");
    expect(existsSync(box.calls)).toBe(false);
  });

  it("refuses without the owner's age key, before asking for any token", () => {
    const box = sandbox({ ageKey: false });
    const result = runWizard(box, [], "\n");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("age key");
    expect(result.stdout).not.toContain("Paste the");
    expect(existsSync(box.calls)).toBe(false);
  });
});

describe("cloudflare wizard token storage", () => {
  it("sends each token to sops through stdin, never through argv", () => {
    const box = sandbox();
    const result = runWizard(box, [], `${fullRun().join("\n")}\n`);
    expect(result.status).toBe(0);

    const calls = read(box.calls);
    const sopsCalls = calls
      .split("\n")
      .filter((line) => line.startsWith("sops "));
    expect(sopsCalls).toHaveLength(2);
    for (const line of sopsCalls) {
      expect(line).toContain("--encrypt");
      expect(line).not.toContain(EXTERNAL_TOKEN);
      expect(line).not.toContain(ACME_TOKEN);
    }
    expect(calls).not.toContain("kubectl");

    const stdin = read(box.sopsStdin);
    expect(stdin).toContain(`"namespace":"kore-external-dns"`);
    expect(stdin).toContain(`"api-token":"${EXTERNAL_TOKEN}"`);
    expect(stdin).toContain(`"namespace":"cert-manager"`);
    expect(stdin).toContain(`"api-token":"${ACME_TOKEN}"`);
    expect(stdin.match(/"kind":"Secret"/g)).toHaveLength(2);
  });

  it("prints no token", () => {
    const result = runWizard(sandbox(), [], `${fullRun().join("\n")}\n`);
    expect(result.stdout).not.toContain(EXTERNAL_TOKEN);
    expect(result.stdout).not.toContain(ACME_TOKEN);
    expect(result.stderr).not.toContain(EXTERNAL_TOKEN);
    expect(result.stderr).not.toContain(ACME_TOKEN);
  });

  it("writes only ciphertext, and no file under the repository holds a token", () => {
    const box = sandbox();
    runWizard(box, [], `${fullRun().join("\n")}\n`);
    expect(read(join(box.cwd, DOCUMENTS, EXTERNAL_DOCUMENT))).toBe(CIPHERTEXT);
    expect(read(join(box.cwd, DOCUMENTS, ACME_DOCUMENT))).toBe(CIPHERTEXT);
    for (const file of filesUnder(box.cwd)) {
      const text = read(file);
      expect(text).not.toContain(EXTERNAL_TOKEN);
      expect(text).not.toContain(ACME_TOKEN);
    }
  });
});

describe("cloudflare wizard token decisions", () => {
  it("never asks for the OpenTofu token, which it does not store", () => {
    const box = sandbox();
    const result = runWizard(box, [], `${fullRun().join("\n")}\n`);
    expect(result.stdout).not.toContain("Paste the OpenTofu");
    expect(read(box.sopsStdin)).not.toContain("CLOUDFLARE_API_TOKEN");
  });

  it("encrypts nothing when the owner declines the store", () => {
    const box = sandbox();
    const result = runWizard(
      box,
      [],
      ["", "y", "y", "y", "y", EXTERNAL_TOKEN, "n", ""].join("\n") + "\n",
    );
    expect(result.status).toBe(1);
    expect(read(box.calls)).not.toContain("--encrypt");
    expect(existsSync(join(box.cwd, DOCUMENTS, EXTERNAL_DOCUMENT))).toBe(false);
  });

  it("keeps an existing document when the owner declines to replace it", () => {
    const box = sandbox({
      existing: { [EXTERNAL_DOCUMENT]: "old-ciphertext\n" },
    });
    const result = runWizard(
      box,
      [],
      ["", "y", "y", "y", "y", "n", ACME_TOKEN, "y"].join("\n") + "\n",
    );
    expect(result.status).toBe(0);
    expect(read(join(box.cwd, DOCUMENTS, EXTERNAL_DOCUMENT))).toBe(
      "old-ciphertext\n",
    );
    expect(read(box.sopsStdin)).not.toContain(
      `"namespace":"kore-external-dns"`,
    );
    expect(read(box.sopsStdin)).toContain(`"api-token":"${ACME_TOKEN}"`);
  });

  it("refuses a token that is not the shape of a Cloudflare token, and names no value", () => {
    const box = sandbox();
    const result = runWizard(
      box,
      [],
      ["", "y", "y", "y", "y", "not a token!", ""].join("\n") + "\n",
    );
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain("not a token!");
    expect(read(box.calls)).not.toContain("--encrypt");
  });
});
