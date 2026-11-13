import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  ctx,
  FAKE_IDENTITY,
  FAKE_RECIPIENT,
  files,
  LOCAL_RECIPIENT,
  outside,
  run,
  useNightlySandbox,
} from "./nightly-script.fixtures.js";

useNightlySandbox();

const facts = () => readFileSync(outside("facts"), "utf8");

test("the scratch overlay exists before the first local up and is gone after cleanup", () => {
  const { status } = run(["test:integration:a"]);
  expect(status).toBe(0);
  expect(facts()).toMatch(/^kore local up .*overlay=present$/m);
  expect(existsSync(join(ctx.repo, "infra/environments/nightly"))).toBe(false);
});

test("the scratch overlay has its own environment, cluster and context, and the committed local overlay is untouched", () => {
  const before = readFileSync(
    join(ctx.repo, "infra/environments/local/environment.yaml"),
    "utf8",
  );
  const secret = readFileSync(
    join(ctx.repo, "infra/environments/local/secrets/sops-canary.enc.yaml"),
    "utf8",
  );
  let overlay = "";
  const { status } = run(["test:integration:a"], [], {
    KORE_NIGHTLY_KORE: `${join(ctx.dir, "snapshot.sh")}`,
  });
  expect(status).toBe(1); // the snapshot fake records the overlay, then fails
  overlay = readFileSync(outside("overlay-environment"), "utf8");
  expect(overlay).toContain('"name": "nightly"');
  expect(overlay).toContain('"kubeContext": "k3d-kore-nightly"');
  expect(overlay).toContain('"clusterName": "kore-nightly"');
  expect(
    readFileSync(
      join(ctx.repo, "infra/environments/local/environment.yaml"),
      "utf8",
    ),
  ).toBe(before);
  expect(
    readFileSync(
      join(ctx.repo, "infra/environments/local/secrets/sops-canary.enc.yaml"),
      "utf8",
    ),
  ).toBe(secret);
});

test("the overlay's secrets are encrypted to a fresh recipient, never the owner's", () => {
  const { status } = run(["test:integration:a"], [], {
    KORE_NIGHTLY_KORE: `${join(ctx.dir, "snapshot.sh")}`,
  });
  expect(status).toBe(1);
  const sopsConfig = readFileSync(outside("overlay-sops-yaml"), "utf8");
  expect(sopsConfig).toContain(FAKE_RECIPIENT);
  expect(sopsConfig).not.toContain(LOCAL_RECIPIENT);
  const canary = readFileSync(outside("overlay-canary"), "utf8");
  expect(canary).toContain(FAKE_RECIPIENT);
  expect(canary).not.toContain(LOCAL_RECIPIENT);
  expect(readFileSync(outside("sops-args"), "utf8")).toMatch(/--encrypt/);
});

test("plaintext secrets and the age identity never touch disk", () => {
  const { status, stdout, stderr } = run(["test:integration:a"]);
  expect(status).toBe(0);
  const plaintext = readFileSync(outside("sops-stdin"), "utf8");
  expect(plaintext).toMatch(/canary: \S{16,}/);
  const value = /canary: (\S+)/.exec(plaintext)?.[1] ?? "";
  for (const file of [...files(ctx.repo), ...files(join(ctx.dir, "tmp"))]) {
    const text = readFileSync(file, "utf8");
    expect(text, file).not.toContain(value);
    expect(text, file).not.toContain(FAKE_IDENTITY);
  }
  expect(
    existsSync(outside("live-hits"))
      ? readFileSync(outside("live-hits"), "utf8")
      : "",
  ).toBe(""); // nothing leaked mid-run
  expect(stdout + stderr).not.toContain(value);
  expect(stdout + stderr).not.toContain(FAKE_IDENTITY);
  expect(readFileSync(outside("sops-args"), "utf8")).not.toContain(
    FAKE_IDENTITY,
  );
});

test("the identity reaches kore and sops only through the environment, and each run draws a fresh canary", () => {
  expect(run(["test:integration:a"]).status).toBe(0);
  expect(facts()).toMatch(/^kore local up .* identity=yes /m);
  const first = readFileSync(outside("sops-stdin"), "utf8");
  rmSync(outside("facts"));
  expect(run(["test:integration:a"]).status).toBe(0);
  expect(readFileSync(outside("sops-stdin"), "utf8")).not.toBe(first);
});

test("the suites are pointed at the scratch environment", () => {
  expect(run(["test:integration:a"]).status).toBe(0);
  expect(facts()).toMatch(
    /^suite test:integration:a identity=yes env=nightly /m,
  );
});

test("a secret the generator does not know fails before any cluster work and names the file", () => {
  writeFileSync(
    join(ctx.repo, "infra/environments/local/secrets/extra.enc.yaml"),
    "kind: Secret\n",
  );
  const { status, stderr, calls } = run(["test:integration:a"]);
  expect(status).toBe(1);
  expect(stderr).toMatch(/extra\.enc\.yaml/);
  expect(stderr).toMatch(/generat/);
  expect(calls.some((call) => call.startsWith("kore local up"))).toBe(false);
});

test("the job summary records the duration and the peak memory", () => {
  writeFileSync(
    join(ctx.dir, "meminfo"),
    "MemTotal:       16384000 kB\nMemFree:         1000000 kB\nMemAvailable:   10384000 kB\n",
  );
  const summary = join(ctx.dir, "summary.md");
  const { status } = run(["test:integration:a"], [], {
    GITHUB_STEP_SUMMARY: summary,
  });
  expect(status).toBe(0);
  const text = readFileSync(summary, "utf8");
  expect(text).toMatch(/duration: \d+s/i);
  expect(text).toMatch(/peak memory: 5859 MiB/i);
});

test("without /proc/meminfo the summary says memory was not measured", () => {
  const summary = join(ctx.dir, "summary.md");
  const { status } = run(["test:integration:a"], [], {
    GITHUB_STEP_SUMMARY: summary,
    KORE_NIGHTLY_MEMINFO: join(ctx.dir, "absent"),
  });
  expect(status).toBe(0);
  expect(readFileSync(summary, "utf8")).toMatch(/peak memory: not measured/i);
});
