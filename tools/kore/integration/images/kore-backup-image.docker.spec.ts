import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { beforeAll, describe, test } from "vitest";
import { findRoot } from "../../src/config/index.js";

// Opt-in: it needs docker and builds the kore-backup image. Run with
// `npm run test:kore-backup-image` when changing images/kore-backup or its
// release steps. No cluster and no registry are used: the program runs against
// a fake target and must fail at pg_dump, which proves it reached pg_dump.

const run = promisify(execFile);
const image = "kore-backup:smoke";

interface Docker {
  status: number;
  stdout: string;
  stderr: string;
}

function docker(args: string[]): Docker {
  const result = spawnSync("docker", args, { encoding: "utf8" });
  return {
    status: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

// A fake S3 target at a closed loopback port: nothing listens, so the program
// fails at pg_dump's connection, before any upload or encryption.
const fakeTarget = [
  "--env",
  "KORE_BACKUP_ENDPOINT=http://127.0.0.1:9",
  "--env",
  "KORE_BACKUP_BUCKET=smoke",
  "--env",
  "KORE_BACKUP_REGION=us-east-1",
  "--env",
  "KORE_BACKUP_PATH_STYLE=true",
  "--env",
  "KORE_BACKUP_KIND=interim",
  "--env",
  "AWS_ACCESS_KEY_ID=smoke",
  "--env",
  "AWS_SECRET_ACCESS_KEY=smoke",
  "--env",
  "PGHOST=127.0.0.1",
  "--env",
  "PGPORT=9",
];

// The flags of one real-data backup: two public recipients, as the job names them.
const programArgs = [
  "--environment",
  "local",
  "--namespace",
  "kore",
  "--cluster",
  "smoke",
  "--database",
  "app",
  "--recipient",
  "age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p",
  "--recipient",
  "age12mqechtl4xrs0mtl9ase7ayup36t8ad7f3ut85v7hgcnwm9f0p6sgg8hrx",
];

describe.runIf(process.env["KORE_CHECK_KORE_BACKUP_IMAGE"] === "1")(
  "the kore-backup image runs without a shell",
  () => {
    beforeAll(async () => {
      await run(
        "docker",
        [
          "build",
          "--file",
          "images/kore-backup/Dockerfile",
          "--tag",
          image,
          "tools/kore",
        ],
        { cwd: await findRoot(), maxBuffer: 64 * 1024 * 1024 },
      );
    }, 900_000);

    test("pg_dump starts from the image and is the PostgreSQL 18 client", () => {
      const result = docker([
        "run",
        "--rm",
        "--entrypoint",
        "/usr/local/bin/pg_dump",
        image,
        "--version",
      ]);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /^pg_dump \(PostgreSQL\) 18\./);
    });

    test("age starts from the image at the mise-pinned release", () => {
      const result = docker([
        "run",
        "--rm",
        "--entrypoint",
        "/usr/local/bin/age",
        image,
        "--version",
      ]);
      assert.equal(result.status, 0, result.stderr);
      assert.match(`${result.stdout}${result.stderr}`, /v1\.3\.2/);
    });

    test("no shell exists: an exec of /bin/sh fails, so the image is not a shell", () => {
      const result = docker([
        "run",
        "--rm",
        "--entrypoint",
        "/bin/sh",
        image,
        "-c",
        "true",
      ]);
      assert.notEqual(result.status, 0);
    });

    test("the program starts from the image and fails at pg_dump against a fake target, before any upload", () => {
      const result = docker([
        "run",
        "--rm",
        ...fakeTarget,
        image,
        ...programArgs,
      ]);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /^error: .*pg_dump/m);
      assert.doesNotMatch(result.stderr, /is not set/);
    });
  },
);
