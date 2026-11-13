import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const WIZARD = resolve(import.meta.dirname, "..", "wizards", "identities.sh");
const PAT = "github_pat_judge_secret_value";
const PEM =
  "-----BEGIN PRIVATE KEY-----\nMIItestkeymaterial\n-----END PRIVATE KEY-----\n";

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

interface Sandbox {
  home: string;
  /** Where the wizard runs and where any stray file would land. */
  cwd: string;
  pem: string;
  /** One line per command the wizard ran: `name args`. */
  calls: string;
  /** What each `security` received on stdin. */
  securityStdin: string;
}

/** Shims for every outside tool: they log what they were given and touch nothing. */
function sandbox(): Sandbox & { bin: string } {
  const root = mkdtempSync(join(tmpdir(), "kore-wizard-"));
  scratch.push(root);
  const bin = join(root, "bin");
  const home = join(root, "home");
  const cwd = join(root, "cwd");
  for (const dir of [bin, home, cwd]) {
    spawnSync("mkdir", ["-p", dir]);
  }
  const pem = join(root, "downloaded.pem");
  writeFileSync(pem, PEM);
  const calls = join(root, "calls.log");
  const securityStdin = join(root, "security-stdin.log");
  const shim = (name: string, body: string) => {
    const path = join(bin, name);
    writeFileSync(
      path,
      `#!/bin/sh\necho "${name} $*" >> "${calls}"\n${body}\n`,
    );
    chmodSync(path, 0o755);
  };
  shim("security", `cat >> "${securityStdin}"`);
  shim(
    "gh",
    `case "$*" in "auth status") exit 0;; "api user --jq .login") echo kore-judge;; esac`,
  );
  for (const opener of ["open", "xdg-open", "wslview", "explorer.exe"]) {
    shim(opener, "exit 0");
  }
  shim("rm", "exit 0");
  return { bin, home, cwd, pem, calls, securityStdin };
}

function runWizard(
  box: Sandbox & { bin: string },
  args: string[],
  input: string,
) {
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

const read = (path: string) =>
  existsSync(path) ? readFileSync(path, "utf8") : "";

describe("identities wizard", () => {
  it("runs every stage end to end in dry-run mode and touches nothing", () => {
    const box = sandbox();
    const result = runWizard(box, ["--dry-run"], "");
    expect(result.status).toBe(0);
    for (const n of [1, 2, 3, 4, 5]) {
      expect(result.stdout).toContain(`Stage ${n}/5`);
    }
    expect(result.stdout).toContain("Setup complete");
    // No outside tool ran: not security, gh, a browser opener or rm.
    expect(existsSync(box.calls)).toBe(false);
    expect(readdirSync(box.cwd)).toEqual([]);
    expect(readdirSync(box.home)).toEqual([]);
    expect(readFileSync(box.pem, "utf8")).toBe(PEM);
  });

  it("says in a dry run what it would store, without a prompt waiting", () => {
    const box = sandbox();
    const out = runWizard(box, ["--dry-run"], "").stdout;
    for (const item of [
      "kore.writer.app-id",
      "kore.writer.private-key",
      "kore.writer.installation-id",
      "kore.judge.pat",
    ]) {
      expect(out).toContain(`would store keychain item ${item}`);
    }
  });

  it("refuses an option it does not know", () => {
    const result = runWizard(sandbox(), ["--wet"], "");
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--wet");
  });
});

describe("identities wizard keychain", () => {
  it("stores each secret in the keychain through stdin, never argv, and prints none", () => {
    const box = sandbox();
    const input = [
      "", // ready to start
      "y", // an owner
      "12345", // App ID
      "y", // permissions are right
      box.pem,
      "y", // delete the pem
      "678", // installation id
      "y", // installed on kore only
      "kore-judge",
      PAT,
    ].join("\n");
    const result = runWizard(box, [], `${input}\n`);
    expect(result.status).toBe(0);

    const calls = read(box.calls);
    expect(calls).not.toContain("add-generic-password");
    expect(calls.split("\n").filter((l) => l.startsWith("security"))).toEqual(
      Array(4).fill("security -i"),
    );
    const stdin = read(box.securityStdin);
    const b64 = Buffer.from(PEM).toString("base64");
    expect(stdin).toContain("-s kore.writer.app-id -a kore -w 12345");
    expect(stdin).toContain("-s kore.writer.installation-id -a kore -w 678");
    expect(stdin).toContain(`-s kore.writer.private-key -a kore -w ${b64}`);
    expect(stdin).toContain(`-s kore.judge.pat -a kore -w ${PAT}`);

    const shown = `${result.stdout}${result.stderr}${calls}`;
    expect(shown).not.toContain(PAT);
    expect(shown).not.toContain(b64);
    expect(shown).not.toContain("MIItestkeymaterial");
  });

  it("passes the judge token to gh through its environment, not its arguments", () => {
    const box = sandbox();
    const input = [
      "",
      "y",
      "1",
      "y",
      box.pem,
      "n",
      "2",
      "y",
      "kore-judge",
      PAT,
    ];
    runWizard(box, [], `${input.join("\n")}\n`);
    expect(read(box.calls)).toContain("gh api user --jq .login");
    expect(read(box.calls)).not.toContain(PAT);
  });
});

describe("identities wizard files", () => {
  it("writes no file and removes the .pem only after you confirm", () => {
    const box = sandbox();
    const input = [
      "",
      "y",
      "1",
      "y",
      box.pem,
      "y",
      "2",
      "y",
      "kore-judge",
      PAT,
    ];
    runWizard(box, [], `${input.join("\n")}\n`);
    expect(read(box.calls)).toContain(`rm -P ${box.pem}`);
    expect(readdirSync(box.cwd)).toEqual([]);
    expect(readdirSync(box.home)).toEqual([]);

    const kept = sandbox();
    const decline = [
      "",
      "y",
      "1",
      "y",
      kept.pem,
      "n",
      "2",
      "y",
      "kore-judge",
      PAT,
    ];
    const result = runWizard(kept, [], `${decline.join("\n")}\n`);
    expect(read(kept.calls)).not.toContain("rm -P");
    expect(result.stdout).toContain("delete it yourself");
  });

  it("stops without storing the judge token when GitHub does not know it", () => {
    const box = sandbox();
    writeFileSync(
      join(box.bin, "gh"),
      `#!/bin/sh\ncase "$*" in "auth status") exit 0;; *) exit 1;; esac\n`,
    );
    const input = [
      "",
      "y",
      "1",
      "y",
      box.pem,
      "n",
      "2",
      "y",
      "kore-judge",
      PAT,
    ];
    const result = runWizard(box, [], `${input.join("\n")}\n`);
    expect(result.status).not.toBe(0);
    expect(read(box.securityStdin)).not.toContain("kore.judge.pat");
  });

  it("never writes a secret anywhere but the keychain or a dotenv file", () => {
    const script = readFileSync(WIZARD, "utf8");
    const stages = script.slice(script.indexOf("run_wizard() {"));
    expect(stages).not.toMatch(/write_env|set_secret|set_var/);
    expect(stages).not.toMatch(/security\s+add-generic-password/);
    expect(stages).not.toMatch(/>\s*"?\$?\{?(PEM|JUDGE|WRITER)/);
  });
});
