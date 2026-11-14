import { list } from "../testing/index.js";
import { loadRepository } from "../config/index.js";
import assert from "node:assert/strict";
import { test } from "vitest";

import { CommandError } from "../runtime/index.js";
import type { RunOptions, RunResult, Runner } from "../runtime/index.js";
import {
  issuerManifest,
  installLocalTrust,
  removeLocalTrustArtifacts,
} from "./trust.js";
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("CA issuer manifest references a generated secret and never embeds key material", () => {
  const manifest = issuerManifest("kore-local-ca", "kore-local-ca-key-pair");
  assert.match(manifest, /kind: ClusterIssuer/);
  assert.match(manifest, /secretName: kore-local-ca-key-pair/);
  assert.doesNotMatch(manifest, /BEGIN (RSA )?PRIVATE KEY/);
});

type Call = { command: string; args: readonly string[]; options?: RunOptions };

function recordingRunner(): { runner: Runner; calls: Call[] } {
  const calls: Call[] = [];
  const runner: Runner = {
    async run(
      command: string,
      args: readonly string[],
      options?: RunOptions,
    ): Promise<RunResult> {
      if (command === "k3d") {
        return { stdout: list(1), stderr: "", code: 0 };
      }
      calls.push({ command, args, ...(options ? { options } : {}) });
      let stdout = "";
      if (args.includes("jsonpath={.metadata.name}")) {
        stdout = "kube-system";
      } else if (command === "mkcert" && args[0] === "-CAROOT") {
        stdout = "/tmp";
      } else if (args.includes("create") && args.includes("secret")) {
        stdout = "apiVersion: v1\nkind: Secret\n";
      }
      return { stdout, stderr: "", code: 0 };
    },
  };
  return { runner, calls };
}

function appliedInputs(calls: Call[]): string[] {
  return calls
    .filter(({ args }) => args.includes("--filename"))
    .map(({ options }) => options?.input ?? "");
}

test("local trust installation hands the gateway namespace to Helm ownership", async () => {
  const { runner, calls } = recordingRunner();
  await installLocalTrust(await loadRepository("local"), runner);
  assert.ok(
    appliedInputs(calls).some(
      (input) =>
        input.includes("name: kore-system") &&
        input.includes("app.kubernetes.io/managed-by: Helm") &&
        input.includes("meta.helm.sh/release-name: kore-platform-config"),
    ),
  );
});

test("local trust installation builds the CA secret from the mkcert root for cert-manager", async () => {
  const { runner, calls } = recordingRunner();
  await installLocalTrust(await loadRepository("local"), runner);
  const create = calls.find(({ args }) => args.includes("create"));
  assert.ok(create);
  assert.ok(create.args.includes("cert-manager"));
  assert.ok(create.args.includes("/tmp/rootCA.pem"));
  assert.ok(create.args.includes("--dry-run=client"));
});

test("local trust installation applies the issuer then waits for it to be ready", async () => {
  const { runner, calls } = recordingRunner();
  await installLocalTrust(await loadRepository("local"), runner);
  const issuer = calls.findIndex(({ options }) =>
    options?.input?.includes("name: kore-local-ca"),
  );
  const wait = calls.findIndex(
    ({ args }) =>
      args.includes("wait") && args.includes("clusterissuer/kore-local-ca"),
  );
  assert.ok(issuer >= 0 && wait > issuer);
  assert.ok(calls[wait]?.args.includes("--for=condition=Ready"));
});

test("trust installation rejects managed environments before side effects", async () => {
  const base = await loadRepository("local");
  const repository = {
    ...base,
    environment: { ...base.environment, provider: "managed" as const },
  };
  let calls = 0;
  const runner: Runner = {
    async run(): Promise<RunResult> {
      calls += 1;
      return { stdout: "", stderr: "", code: 0 };
    },
  };
  await assert.rejects(
    installLocalTrust(repository, runner),
    /only valid for a local k3d environment/,
  );
  assert.equal(calls, 0);
});

test("trust installation fails closed when mkcert does not expose a CA root", async () => {
  const repository = await loadRepository("local");
  const runner: Runner = {
    async run(command: string, args: readonly string[]): Promise<RunResult> {
      if (command === "k3d") {
        return { stdout: list(1), stderr: "", code: 0 };
      }
      if (command === "kubectl" && args.includes("jsonpath={.metadata.name}")) {
        return { stdout: "kube-system", stderr: "", code: 0 };
      }
      if (command === "mkcert" && args[0] === "-CAROOT") {
        return { stdout: "  \n", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  };
  await assert.rejects(
    installLocalTrust(repository, runner),
    /did not return its CA root/,
  );
});

test("removes the temporary CA artifact directory for the selected environment", async () => {
  const environment = `test-${process.pid}`;
  const artifacts = join(tmpdir(), `kore-ca-${environment}`);
  await mkdir(artifacts, { recursive: true });
  try {
    await removeLocalTrustArtifacts({
      environment: { name: environment },
    } as never);
    await assert.rejects(stat(artifacts), { code: "ENOENT" });
  } finally {
    await rm(artifacts, { recursive: true, force: true });
  }
});

async function caRootWithFiles(files: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kore-caroot-"));
  for (const file of files) {
    await writeFile(join(root, file), "x");
  }
  return root;
}

function trustRunner(caRoot: string, verifyFails: boolean | Error = false) {
  const { runner, calls } = recordingRunner();
  const wrapped: Runner = {
    async run(command, args, options) {
      if (command === "k3d") {
        return { stdout: list(1), stderr: "", code: 0 };
      }
      if (command === "mkcert" && args[0] === "-CAROOT") {
        calls.push({ command, args });
        return { stdout: caRoot, stderr: "", code: 0 };
      }
      if (command === "security" && verifyFails) {
        calls.push({ command, args });
        throw verifyFails instanceof Error
          ? verifyFails
          : new CommandError(command, args, {
              stdout: "",
              stderr: "not trusted",
              code: 1,
            });
      }
      return runner.run(command, args, options);
    },
  };
  return { runner: wrapped, calls };
}

const installed = (calls: Call[]) =>
  calls.some(
    ({ command, args }) => command === "mkcert" && args[0] === "-install",
  );

test("mkcert -install is skipped when the CA files exist and macOS already trusts the root", async () => {
  const caRoot = await caRootWithFiles(["rootCA.pem", "rootCA-key.pem"]);
  try {
    const { runner, calls } = trustRunner(caRoot);
    await installLocalTrust(await loadRepository("local"), runner, {
      platform: "darwin",
    });
    assert.equal(installed(calls), false);
    const verify = calls.find(({ command }) => command === "security");
    assert.deepEqual(verify?.args, [
      "verify-cert",
      "-c",
      join(caRoot, "rootCA.pem"),
    ]);
    assert.ok(calls.some(({ args }) => args.includes("--dry-run=client")));
  } finally {
    await rm(caRoot, { recursive: true, force: true });
  }
});

test("mkcert -install still runs when the host trust check fails", async () => {
  const caRoot = await caRootWithFiles(["rootCA.pem", "rootCA-key.pem"]);
  try {
    const { runner, calls } = trustRunner(caRoot, true);
    await installLocalTrust(await loadRepository("local"), runner, {
      platform: "darwin",
    });
    assert.equal(installed(calls), true);
  } finally {
    await rm(caRoot, { recursive: true, force: true });
  }
});

test("mkcert -install still runs when the CA key is missing", async () => {
  const caRoot = await caRootWithFiles(["rootCA.pem"]);
  try {
    const { runner, calls } = trustRunner(caRoot);
    await installLocalTrust(await loadRepository("local"), runner, {
      platform: "darwin",
    });
    assert.equal(installed(calls), true);
    assert.equal(
      calls.some(({ command }) => command === "security"),
      false,
    );
  } finally {
    await rm(caRoot, { recursive: true, force: true });
  }
});

test("mkcert -install always runs on hosts without a supported trust check", async () => {
  const caRoot = await caRootWithFiles(["rootCA.pem", "rootCA-key.pem"]);
  try {
    const { runner, calls } = trustRunner(caRoot);
    await installLocalTrust(await loadRepository("local"), runner, {
      platform: "linux",
    });
    assert.equal(installed(calls), true);
    assert.equal(
      calls.some(({ command }) => command === "security"),
      false,
    );
  } finally {
    await rm(caRoot, { recursive: true, force: true });
  }
});

test("a missing security binary is rethrown rather than treated as untrusted", async () => {
  const caRoot = await caRootWithFiles(["rootCA.pem", "rootCA-key.pem"]);
  try {
    const spawnError = Object.assign(new Error("spawn security ENOENT"), {
      code: "ENOENT",
    });
    const { runner, calls } = trustRunner(caRoot, spawnError);
    await assert.rejects(
      installLocalTrust(await loadRepository("local"), runner, {
        platform: "darwin",
      }),
      /spawn security ENOENT/,
    );
    assert.equal(installed(calls), false);
  } finally {
    await rm(caRoot, { recursive: true, force: true });
  }
});

test("an unreadable CA file is rethrown rather than treated as untrusted", async () => {
  const caRoot = await caRootWithFiles(["rootCA.pem", "rootCA-key.pem"]);
  try {
    await chmod(caRoot, 0o000);
    const { runner, calls } = trustRunner(caRoot);
    await assert.rejects(
      installLocalTrust(await loadRepository("local"), runner, {
        platform: "darwin",
      }),
      { code: "EACCES" },
    );
    assert.equal(installed(calls), false);
  } finally {
    await chmod(caRoot, 0o700);
    await rm(caRoot, { recursive: true, force: true });
  }
});
