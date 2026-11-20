import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const WIZARD = resolve(
  import.meta.dirname,
  "..",
  "wizards",
  "identities.sh",
);
export const PAT = "github_pat_judge_secret_value";
export const PEM =
  "-----BEGIN PRIVATE KEY-----\nMIItestkeymaterial\n-----END PRIVATE KEY-----\n";

const scratch: string[] = [];

/** Deletes every sandbox made so far; a spec calls it from afterEach. */
export function removeScratch(): void {
  for (const dir of scratch.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

export interface Sandbox {
  bin: string;
  home: string;
  /** Where the wizard runs and where any stray file would land. */
  cwd: string;
  pem: string;
  /** One line per command the wizard ran: `name args`. */
  calls: string;
  /** What each `security` received on stdin. */
  securityStdin: string;
  /** The keychain services already stored: one per line; `security find-generic-password` answers from it. */
  present: string;
  /** Keychain values for `find-generic-password -w`: one `service=value` per line. */
  values: string;
  /** What each `ssh` received on stdin. */
  sshStdin: string;
}

/** Shims for every outside tool: they log what they were given and touch nothing. */
export function sandbox(): Sandbox {
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
  const present = join(root, "present.txt");
  writeFileSync(present, "");
  const values = join(root, "values.txt");
  writeFileSync(values, "");
  const sshStdin = join(root, "ssh-stdin.log");
  const shim = (name: string, body: string) => {
    const path = join(bin, name);
    writeFileSync(
      path,
      `#!/bin/sh\necho "${name} $*" >> "${calls}"\n${body}\n`,
    );
    chmodSync(path, 0o755);
  };
  // A lookup (`find-generic-password`) answers from the present list, or from the values with -w, and reads no stdin; a store reads its stdin.
  shim(
    "security",
    `if [ "$1" = find-generic-password ]; then case "$*" in *" -w") line=$(grep "^$3=" "${values}") || exit 44; printf '%s\\n' "\${line#*=}";; *) grep -qx "$3" "${present}";; esac; else cat >> "${securityStdin}"; fi`,
  );
  // ssh answers the age public key query and logs whatever else it is fed on stdin.
  shim(
    "ssh",
    `case "$*" in *age-keygen*) echo age1hostpublickeyfortests;; *) cat >> "${sshStdin}";; esac`,
  );
  shim(
    "gh",
    `case "$*" in "auth status") exit 0;; "api user --jq .login") echo kore-judge;; esac`,
  );
  for (const opener of ["open", "xdg-open", "wslview", "explorer.exe"]) {
    shim(opener, "exit 0");
  }
  shim("rm", "exit 0");
  return {
    bin,
    home,
    cwd,
    pem,
    calls,
    securityStdin,
    present,
    values,
    sshStdin,
  };
}

export function runWizard(box: Sandbox, args: string[], input: string) {
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

export const read = (path: string) =>
  existsSync(path) ? readFileSync(path, "utf8") : "";
