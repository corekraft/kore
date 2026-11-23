import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { EvalReport } from "../../src/delivery/index.js";
import { main } from "../../src/testing/index.js";

// The eval runs on a real git repository built from the fixture app: a base commit with
// the checkout alone, and a head commit that adds flags.yaml under the Safety-pattern trailer.
const fixture = fileURLToPath(new URL("./fixtures/app", import.meta.url));
const digest = `sha256:${"e".repeat(64)}`;
const version = "1.2.3+abc1234";
const today = "2026-11-23";

let app: string;
let scratch: string;
let base: string;
let written: string[];

// Under a git hook GIT_DIR names the real repository, so the fixture's git runs without GIT_* (#368).
const withoutGit = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
  );

// The GIT_* names the test process inherited; they are cleared for the test and restored after.
const inheritedGit = Object.entries(process.env).filter(([name]) =>
  name.startsWith("GIT_"),
);

const git = (...args: string[]) =>
  execFileSync(
    "git",
    [
      "-C",
      app,
      "-c",
      "user.name=kore-test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { encoding: "utf8", env: withoutGit() },
  );

// The fixture keeps the manifest as flags.json, so a formatter cannot rewrite it into non-JSON
// YAML; the test writes it to the app as flags.yaml.
const fixtureText = (path: string) => readFile(join(fixture, path), "utf8");

beforeEach(async () => {
  for (const [name] of inheritedGit) {
    delete process.env[name];
  }
  app = await mkdtemp(join(tmpdir(), "kore-eval-app-"));
  scratch = await mkdtemp(join(tmpdir(), "kore-eval-scratch-"));
  git("init", "--quiet");
  await cp(join(fixture, "src"), join(app, "src"), { recursive: true });
  git("add", "-A");
  git("commit", "--quiet", "-m", "chore: start the checkout");
  base = git("rev-parse", "HEAD").trim();
  // The platform always passes --published; an empty list is the first release's.
  await writeFile(join(scratch, "published.json"), "{}");
  written = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    written.push(String(chunk));
    return true;
  });
});

afterEach(async () => {
  for (const [name, value] of inheritedGit) {
    process.env[name] = value;
  }
  vi.restoreAllMocks();
  await rm(app, { recursive: true, force: true });
  await rm(scratch, { recursive: true, force: true });
});

/** Commits the head: flags.yaml as given, under the Safety-pattern trailer. */
async function headCommit(flags: string): Promise<void> {
  await writeFile(join(app, "flags.yaml"), flags);
  git("add", "-A");
  git(
    "commit",
    "--quiet",
    "-m",
    "feat: add the new checkout",
    "-m",
    "Safety-pattern: feature-flagged",
  );
}

async function evalApp(extra: string[] = []) {
  const code = await main([
    "eval",
    app,
    "--base",
    base,
    "--version",
    version,
    "--digest",
    digest,
    "--today",
    today,
    "--published",
    join(scratch, "published.json"),
    ...extra,
  ]);
  const report: EvalReport = JSON.parse(written.join(""));
  return { code, report };
}

test("a passing eval of the fixture app prints the verdict and both payloads, and exits 0", async () => {
  await headCommit(await fixtureText("flags.json"));
  const { code, report } = await evalApp();
  expect(code).toBe(0);
  expect(report).toEqual({
    verdict: "pass",
    version,
    digest,
    failures: [],
    warnings: [],
    attestations: {
      "eval-result": {
        _type: "https://in-toto.io/Statement/v1",
        subject: [{ name: version, digest: { sha256: "e".repeat(64) } }],
        predicateType: "urn:kore:eval-result:v1",
        predicate: {
          verdict: "pass",
          version,
          safetyPattern: "feature-flagged",
          checks: [
            "flags-manifest",
            "safety-pattern",
            "version-reuse",
            "flag-expiry",
          ],
          warnings: [],
          expiredFlags: [],
        },
      },
      "flags-manifest": {
        _type: "https://in-toto.io/Statement/v1",
        subject: [{ name: version, digest: { sha256: "e".repeat(64) } }],
        predicateType: "urn:kore:flags-manifest:v1",
        predicate: {
          service: "leads",
          flags: [
            {
              name: "leads.new-checkout",
              default: false,
              owner: "checkout-team",
              safetyPattern: "feature-flagged",
              expiry: "2027-06-30",
              rollout: {
                kind: "flag",
                criteria: ["checkout-errors-below-0.5-percent"],
                soakHours: 4,
              },
            },
          ],
        },
      },
    },
  });
});

test("a flag whose default is on fails the eval, exits 1 and yields no payload to sign", async () => {
  const flags = (await fixtureText("flags.json")).replace(
    '"default": false',
    '"default": true',
  );
  await headCommit(flags);
  const { code, report } = await evalApp();
  expect(code).toBe(1);
  expect(report.verdict).toBe("fail");
  expect(report.failures).toEqual([
    "flag leads.new-checkout: default must be false; every flag ships off",
  ]);
  expect(report).not.toHaveProperty("attestations");
});

test("an expired flag warns, still passes, and is named in the eval result", async () => {
  const flags = (await fixtureText("flags.json")).replace(
    '"expiry": "2027-06-30"',
    '"expiry": "2026-01-15"',
  );
  await headCommit(flags);
  const { code, report } = await evalApp();
  expect(code).toBe(0);
  expect(report.verdict).toBe("pass");
  expect(report.warnings).toEqual([
    "flag leads.new-checkout expired on 2026-01-15; retire it or extend its expiry",
  ]);
  expect(report.attestations?.["eval-result"].predicate).toMatchObject({
    expiredFlags: ["leads.new-checkout"],
  });
});

test("a version published for another digest fails the eval, with no payload", async () => {
  await headCommit(await fixtureText("flags.json"));
  const published = join(scratch, "clash.json");
  await writeFile(
    published,
    JSON.stringify({ [version]: `sha256:${"f".repeat(64)}` }),
  );
  const { code, report } = await evalApp(["--published", published]);
  expect(code).toBe(1);
  expect(report.failures).toEqual([
    `version ${version} is already published for sha256:${"f".repeat(64)}; a new build needs a new version`,
  ]);
  expect(report).not.toHaveProperty("attestations");
});

test("a --base that git does not know is refused, naming the flag to fix", async () => {
  await headCommit(await fixtureText("flags.json"));
  await expect(
    main([
      "eval",
      app,
      "--base",
      "no-such-ref",
      "--version",
      version,
      "--digest",
      digest,
      "--today",
      today,
    ]),
  ).rejects.toThrow(
    /^eval could not read [\s\S]* with git \(diff --name-only no-such-ref HEAD\): [\s\S]*; check that --base no-such-ref names a commit in that repository$/,
  );
});
