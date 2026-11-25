import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { COMMANDS } from "../src/testing/index.js";

// The backup commands through the command table, with a scripted runner for sops and
// kubectl and a stubbed HTTP target. The real domains run together: no cluster and no
// bucket. Each mutation goes through the same table entry the CLI dispatches to.

const WRITE = {
  AWS_ACCESS_KEY_ID: "AKIA-WRITE-EXAMPLE",
  AWS_SECRET_ACCESS_KEY: "write-secret-EXAMPLE",
};
const READ = {
  AWS_ACCESS_KEY_ID: "AKIA-READ-EXAMPLE",
  AWS_SECRET_ACCESS_KEY: "read-secret-EXAMPLE",
};
const DELETE = {
  AWS_ACCESS_KEY_ID: "AKIA-DELETE-EXAMPLE",
  AWS_SECRET_ACCESS_KEY: "delete-secret-EXAMPLE",
};

interface Call {
  command: string;
  args: readonly string[];
  input?: string | undefined;
}

let root: string;
let calls: Call[];
let stdinIsTTY: PropertyDescriptor | undefined;
let stdout: string[];

function documentJson(name: string, namespace: string, values: object) {
  return JSON.stringify({
    apiVersion: "v1",
    kind: "Secret",
    metadata: { name, namespace },
    type: "Opaque",
    stringData: values,
  });
}

/** sops answers each document's path with its decrypted JSON; anything else is an error. */
function documents(): Record<string, string> {
  return {
    [join(root, "infra/environments/vps/secrets/backup-write.enc.yaml")]:
      documentJson("backup-write", "kore-backup", WRITE),
    [join(
      root,
      "infra/environments/vps/controller-secrets/backup-write-read.enc.yaml",
    )]: documentJson("backup-write-read", "kore-backup", READ),
    [join(
      root,
      "infra/environments/vps/controller-secrets/backup-write-delete.enc.yaml",
    )]: documentJson("backup-write-delete", "kore-backup", DELETE),
  };
}

const runner = {
  run: async (
    command: string,
    args: readonly string[],
    options?: { input?: string },
  ) => {
    calls.push({ command, args, input: options?.input });
    if (command === "sops") {
      const text = documents()[args.at(-1) ?? ""];
      if (text === undefined) {
        throw new Error("no such document");
      }
      return { stdout: text, stderr: "", code: 0 };
    }
    return { stdout: "", stderr: "", code: 0 };
  },
};

function repository(features: Record<string, boolean>) {
  return {
    root,
    environment: {
      name: "vps",
      provider: "managed",
      kubeContext: "kore-vps",
      features,
      backup: {
        target: {
          endpoint: "https://s3.example.com",
          bucket: "backups",
          region: "eu-west-1",
          pathStyle: true,
          kind: "interim",
          credentials: { secret: "backup-write" },
        },
        retention: { daily: 14 },
        schedule: "02:00",
      },
    },
  };
}

/** A CommandContext as the CLI builds it: each mutation runs its work on the scripted runner. */
function context(command: string, action: string, repo: object) {
  return {
    command,
    action,
    parsed: { positional: [], flags: new Map() },
    repository: repo,
    environmentName: "vps",
    runner,
    json: true,
    mutate: async (
      _label: string,
      work: (runner: unknown) => Promise<number>,
    ) => await work(runner),
  } as never;
}

function run(command: string, action: string, repo: object) {
  return COMMANDS.get(command)!.run(context(command, action, repo));
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kore-backup-"));
  await mkdir(join(root, "infra/environments/vps/secrets"), {
    recursive: true,
  });
  await mkdir(join(root, "infra/environments/vps/controller-secrets"), {
    recursive: true,
  });
  await writeFile(
    join(root, "infra/environments/vps/secrets/backup-write.enc.yaml"),
    "ciphertext",
  );
  calls = [];
  stdout = [];
  stdinIsTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  Object.defineProperty(process.stdin, "isTTY", {
    value: false,
    configurable: true,
  });
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env["KUBERNETES_SERVICE_HOST"];
  if (stdinIsTTY === undefined) {
    delete (process.stdin as { isTTY?: boolean }).isTTY;
  } else {
    Object.defineProperty(process.stdin, "isTTY", stdinIsTTY);
  }
  await rm(root, { recursive: true, force: true });
});

test("the write-only credential reaches kubectl on stdin only: never an argument, never printed, never a file", async () => {
  expect(
    await run("secrets", "backup", repository({ "database-backups": true })),
  ).toBe(0);

  const applied = calls.find((call) => call.command === "kubectl")!;
  expect(applied.args).toEqual([
    "--context",
    "kore-vps",
    "--namespace",
    "kore-backup",
    "apply",
    "--server-side",
    "--field-manager=kore-backup",
    "--filename=-",
  ]);
  expect(JSON.parse(applied.input!).stringData).toEqual(WRITE);
  expect(JSON.stringify(calls.map((call) => call.args))).not.toContain(
    WRITE.AWS_SECRET_ACCESS_KEY,
  );
  expect(stdout.join("")).not.toContain(WRITE.AWS_SECRET_ACCESS_KEY);
  expect(await readdir(join(root, "infra/environments/vps/secrets"))).toEqual([
    "backup-write.enc.yaml",
  ]);
});

test("with database-backups off, the write-only credential is not read and nothing reaches the cluster", async () => {
  expect(
    await run("secrets", "backup", repository({ "database-backups": false })),
  ).toBe(0);
  expect(calls).toEqual([]);
  expect(stdout.join("")).toContain('"nothing-to-apply"');
});

test("the job's policy printed for the environment allows one action, creating objects under its prefix", async () => {
  expect(
    await run("backup", "policy", repository({ "database-backups": true })),
  ).toBe(0);
  const policy = JSON.parse(stdout.join(""));
  expect(policy.Statement[0]).toEqual({
    Sid: "WriteBackupsOnly",
    Effect: "Allow",
    Action: ["s3:PutObject"],
    Resource: ["arn:aws:s3:::backups/vps/*"],
  });
  expect(calls).toEqual([]);
});

test("prune refuses without a terminal to ask consent on, before any credential is read or any request is sent", async () => {
  const fetch = vi.fn(async () => new Response("", { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  await expect(
    run("backup", "prune", repository({ "database-backups": true })),
  ).rejects.toThrow("backup prune needs a terminal to ask for consent");
  expect(calls).toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
});

test("prune refuses inside a pod, before any credential is read", async () => {
  process.env["KUBERNETES_SERVICE_HOST"] = "10.43.0.1";
  const fetch = vi.fn(async () => new Response("", { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  await expect(
    run("backup", "prune", repository({ "database-backups": true })),
  ).rejects.toThrow("backup prune never runs from a job or a pod");
  expect(calls).toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
});

test("prune refuses while database-backups is off, and reads no credential", async () => {
  const fetch = vi.fn(async () => new Response("", { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  await expect(run("backup", "prune", repository({}))).rejects.toThrow(
    "database-backups is off in vps",
  );
  expect(calls).toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
});
