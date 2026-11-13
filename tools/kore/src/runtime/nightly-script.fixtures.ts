import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";

const realRoot = new URL("../../../..", import.meta.url).pathname;
const realScript = join(realRoot, "tools/kore/scripts/nightly.sh");
export const LOCAL_RECIPIENT =
  "age12mqechtl4xrs0mtl9ase7ayup36t8ad7f3ut85v7hgcnwm9f0p6sgg8hrx";
export const FAKE_RECIPIENT =
  "age1freshrecipientfortheephemeralnightlykeyxxxxxxxxxxxxxxxxxxxx";
export const FAKE_IDENTITY =
  "AGE-SECRET-KEY-1FAKEEPHEMERALIDENTITYFORTHENIGHTLYSPEC";

/** No GIT_* variable: under a git hook GIT_DIR names the real repository, which a fixture's git would read or rewrite (#368). */
const gitEnv = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
);

/** The sandbox of the running spec: `repo` is a copy of the real layout, so no run touches the checkout. */
export const ctx = { dir: "", repo: "", script: "" };

/** Everything a fake wrote that is not a file of the repository or the runner's temp dir. */
export function outside(name: string): string {
  return join(ctx.dir, "outside", name);
}

/** Registers the per-test sandbox: a scratch dir, a fake repository, and a fake `kore` that snapshots the overlay and fails. */
export function useNightlySandbox(): void {
  beforeEach(() => {
    ctx.dir = mkdtempSync(join(tmpdir(), "nightly-spec-"));
    mkdirSync(join(ctx.dir, "outside"));
    mkdirSync(join(ctx.dir, "tmp"));
    ctx.repo = join(ctx.dir, "repo");
    ctx.script = join(ctx.repo, "tools/kore/scripts/nightly.sh");
    mkdirSync(join(ctx.repo, "tools/kore/scripts"), { recursive: true });
    copyFileSync(realScript, ctx.script);
    chmodSync(ctx.script, 0o755);
    cpSync(
      join(realRoot, "infra/environments/local"),
      join(ctx.repo, "infra/environments/local"),
      { recursive: true },
    );
    copyFileSync(join(realRoot, ".sops.yaml"), join(ctx.repo, ".sops.yaml"));
    spawnSync("git", ["init", "--quiet"], { cwd: ctx.repo, env: gitEnv });
    const overlay = join(ctx.repo, "infra/environments/nightly");
    writeFileSync(
      join(ctx.dir, "snapshot.sh"),
      `#!/usr/bin/env bash
case "$*" in "local down"*) exit 0 ;; esac
cp "${overlay}/environment.yaml" "${outside("overlay-environment")}"
cp "${overlay}/.sops.yaml" "${outside("overlay-sops-yaml")}"
cp "${overlay}/secrets/sops-canary.enc.yaml" "${outside("overlay-canary")}"
exit 1
`,
      { mode: 0o755 },
    );
  });
  afterEach(() => {
    rmSync(ctx.dir, { recursive: true, force: true });
  });
}

/** A fake `kore` and suite runner that log each call, failing the ones named in `failOn`. */
export function fakes(failOn: string[] = []) {
  const log = join(ctx.dir, "log");
  const fake = join(ctx.dir, "fake.sh");
  writeFileSync(
    fake,
    `#!/usr/bin/env bash
echo "$*" >> "${log}"

# While the run is live, nothing on disk may hold the plaintext or the identity.
live_check() {
  [ -s "${outside("sops-stdin")}" ] || return 0
  value="$(sed -n 's/^  canary: //p' "${outside("sops-stdin")}")"
  grep -rlF -e "$value" -e "${FAKE_IDENTITY}" "${ctx.dir}/tmp" "${ctx.repo}" 2>/dev/null >> "${outside("live-hits")}"
  true
}
live_check
echo "$* identity=$([ -n "${"$"}{SOPS_AGE_KEY:-}" ] && echo yes || echo no) env=${"$"}{KORE_INTEGRATION_ENVIRONMENT:-unset} overlay=$([ -f "${ctx.repo}/infra/environments/nightly/environment.yaml" ] && echo present || echo absent)" >> "${outside("facts")}"
for bad in ${failOn.map((f) => `"${f}"`).join(" ")}; do
  [ "$*" = "$bad" ] && exit 1
done
exit 0
`,
  );
  chmodSync(fake, 0o755);
  return { log, fake };
}

/** Fake `age-keygen` and `sops`: the sops fake keeps what it was given outside the repository, for the spec to inspect. */
function cryptoFakes() {
  const keygen = join(ctx.dir, "age-keygen.sh");
  writeFileSync(
    keygen,
    `#!/usr/bin/env bash
if [ "$1" = "-y" ]; then cat >/dev/null; echo "${FAKE_RECIPIENT}"; else echo "# created: fake"; echo "${FAKE_IDENTITY}"; fi
`,
  );
  const sops = join(ctx.dir, "sops.sh");
  writeFileSync(
    sops,
    `#!/usr/bin/env bash
echo "$*" >> "${outside("sops-args")}"
echo "identity=$([ -n "${"$"}{SOPS_AGE_KEY:-}" ] && echo yes || echo no)" >> "${outside("sops-identity")}"
cat > "${outside("sops-stdin")}"
echo "sops: {age: [{recipient: ${FAKE_RECIPIENT}}]} # ENC[AES256_GCM,fake]"
`,
  );
  chmodSync(keygen, 0o755);
  chmodSync(sops, 0o755);
  return { keygen, sops };
}

/** A stand-in for GNU timeout that only runs the command, so the order tests need no coreutils. */
function shimDir(): string {
  const bin = join(ctx.dir, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "timeout"), '#!/bin/sh\nshift 2\nexec "$@"\n');
  chmodSync(join(bin, "timeout"), 0o755);
  return bin;
}

export const hasGnuTimeout =
  spawnSync("sh", ["-c", "command -v timeout || command -v gtimeout"], {
    env: gitEnv,
  }).status === 0;

export function files(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

export function run(
  suites: string[],
  failOn: string[] = [],
  extra: Record<string, string | undefined> = {},
) {
  const { log, fake } = fakes(failOn);
  const { keygen, sops } = cryptoFakes();
  const result = spawnSync("/bin/bash", [ctx.script], {
    encoding: "utf8",
    env: {
      PATH: `${shimDir()}:${process.env["PATH"] ?? ""}`,
      TMPDIR: join(ctx.dir, "tmp"),
      KORE_RUN_NIGHTLY: "1",
      KORE_NIGHTLY_AGE_KEYGEN: keygen,
      KORE_NIGHTLY_SOPS: sops,
      KORE_NIGHTLY_MEMINFO: join(ctx.dir, "meminfo"),
      KORE_NIGHTLY_MEM_INTERVAL: "0.1",
      KORE_NIGHTLY_KORE: `${fake} kore`,
      KORE_NIGHTLY_SUITE_CMD: `${fake} suite`,
      KORE_NIGHTLY_SUITES: suites.join("\n"),
      KORE_NIGHTLY_STAGE_TIMEOUT: "30s",
      ...Object.fromEntries(
        Object.entries(extra).filter(([name]) => !name.startsWith("GIT_")),
      ),
    },
  });
  const calls = readFileSync(log, { encoding: "utf8", flag: "a+" })
    .split("\n")
    .filter(Boolean);
  return { ...result, calls };
}
