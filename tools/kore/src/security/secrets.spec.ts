import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { loadRepository } from "../config/index.js";
import type { RunOptions, RunResult, Runner } from "../runtime/index.js";
import { syncLocalSecrets } from "./secrets.js";

class SecretRunner implements Runner {
  calls: { command: string; args: readonly string[]; options?: RunOptions }[] =
    [];
  async run(
    command: string,
    args: readonly string[],
    options?: RunOptions,
  ): Promise<RunResult> {
    this.calls.push({ command, args, ...(options ? { options } : {}) });
    if (command === "sops") {
      return {
        stdout: "apiVersion: v1\nkind: Secret\nmetadata:\n  name: source\n",
        stderr: "",
        code: 0,
      };
    }
    if (
      command === "kubectl" &&
      args.includes("get") &&
      args.includes("externalsecret")
    ) {
      return {
        stdout: "externalsecret.external-secrets.io/reference-app\n",
        stderr: "",
        code: 0,
      };
    }
    if (command === "kubectl" && args.includes("jsonpath={.metadata.name}")) {
      return { stdout: "kube-system", stderr: "", code: 0 };
    }
    return { stdout: "", stderr: "", code: 0 };
  }
}

test("secret sync streams plaintext only through kubectl stdin", async () => {
  const base = await loadRepository("local");
  const root = await mkdtemp(join(tmpdir(), "kore-sops-secrets-"));
  const directory = join(root, "infra/environments/local/secrets");
  const fixture = join(directory, "test.enc.yaml");
  await mkdir(directory, { recursive: true });
  await writeFile(fixture, "sops: encrypted");
  const repository = { ...base, root };
  const runner = new SecretRunner();
  try {
    await syncLocalSecrets(repository, runner);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  const apply = runner.calls.find(
    ({ command, args, options }) =>
      command === "kubectl" &&
      args.includes("-") &&
      options?.input?.startsWith("{") &&
      JSON.parse(options.input).kind === "Secret",
  );
  assert.equal(JSON.parse(apply?.options?.input ?? "{}").kind, "Secret");
  assert.equal(apply?.args.includes("kore-local"), true);
  assert.equal(apply?.args.includes("kore-secret-source"), true);
});

test("local secret sync generates and reuses a private API token after cluster prune", async () => {
  const base = await loadRepository("local");
  const root = await mkdtemp(join(tmpdir(), "kore-local-secrets-"));
  await mkdir(join(root, "infra/environments/local/secrets"), {
    recursive: true,
  });
  await mkdir(join(root, ".kore/state"), { recursive: true });
  const repository = { ...base, root };
  const runner = new SecretRunner();
  try {
    await syncLocalSecrets(repository, runner);
    const tokenPath = join(root, ".kore/state/reference-api-token");
    const token = (await readFile(tokenPath, "utf8")).trim();
    assert.match(token, /^[a-f0-9]{64}$/);
    assert.equal((await stat(tokenPath)).mode & 0o777, 0o600);
    const source = runner.calls.find(
      ({ command, args, options }) =>
        command === "kubectl" &&
        args.includes("apply") &&
        options?.input?.startsWith("{") &&
        JSON.parse(options.input).metadata?.name === "reference-app",
    );
    assert.equal(
      JSON.parse(source?.options?.input ?? "{}").metadata.namespace,
      "kore-secret-source",
    );
    assert.equal(
      source?.options?.input?.includes(Buffer.from(token).toString("base64")),
      true,
    );

    runner.calls = [];
    await syncLocalSecrets(repository, runner);
    assert.equal((await readFile(tokenPath, "utf8")).trim(), token);
    const reapplied = runner.calls.find(
      ({ command, args, options }) =>
        command === "kubectl" &&
        args.includes("apply") &&
        options?.input?.startsWith("{") &&
        JSON.parse(options.input).metadata?.name === "reference-app",
    );
    assert.equal(
      reapplied?.options?.input?.includes(
        Buffer.from(token).toString("base64"),
      ),
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local secret sync immediately retries an existing reference ExternalSecret", async () => {
  const repository = await loadRepository("local");
  const root = await mkdtemp(join(tmpdir(), "kore-secret-reconcile-"));
  await mkdir(join(root, "infra/environments/local/secrets"), {
    recursive: true,
  });
  await mkdir(join(root, ".kore/state"), { recursive: true });
  const runner = new SecretRunner();
  try {
    await syncLocalSecrets({ ...repository, root }, runner);
    const reconcile = runner.calls.find(
      ({ command, args }) => command === "kubectl" && args.includes("annotate"),
    );
    const exists = runner.calls.find(
      ({ command, args }) =>
        command === "kubectl" &&
        args.includes("get") &&
        args.includes("externalsecret"),
    );
    assert.ok(exists);
    assert.ok(reconcile);
    assert.ok(reconcile.args.includes("externalsecret"));
    assert.ok(reconcile.args.includes("reference-app"));
    assert.equal(
      reconcile.args.some((argument) => argument.includes("ignore-not-found")),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("secret sync rejects a corrupted persisted local API token", async () => {
  const base = await loadRepository("local");
  const root = await mkdtemp(join(tmpdir(), "kore-invalid-local-token-"));
  await mkdir(join(root, "infra/environments/local/secrets"), {
    recursive: true,
  });
  await mkdir(join(root, ".kore/state"), { recursive: true });
  await writeFile(
    join(root, ".kore/state/reference-api-token"),
    "not-secret\n",
  );
  try {
    await assert.rejects(
      syncLocalSecrets({ ...base, root }, new SecretRunner()),
      /local API token.*is invalid/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("secret sync rejects managed environments before running commands", async () => {
  const base = await loadRepository("local");
  const repository = {
    ...base,
    environment: { ...base.environment, provider: "managed" as const },
  };
  const runner = new SecretRunner();
  await assert.rejects(
    syncLocalSecrets(repository, runner),
    /only valid for a Minikube environment/,
  );
  assert.equal(runner.calls.length, 0);
});
