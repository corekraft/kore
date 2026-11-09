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

const rotationAnnotation = "platform.kore.dev/rotation-id";

interface Source {
  metadata: { annotations?: Record<string, string> };
  data: Record<string, string>;
}

class SourceRunner implements Runner {
  calls: { command: string; args: readonly string[]; options?: RunOptions }[] =
    [];
  constructor(private readonly sourceExists: boolean) {}
  async run(
    command: string,
    args: readonly string[],
    options?: RunOptions,
  ): Promise<RunResult> {
    this.calls.push({ command, args, ...(options ? { options } : {}) });
    const ok = (stdout: string): RunResult => ({ stdout, stderr: "", code: 0 });
    if (command === "kubectl" && args.includes("jsonpath={.metadata.name}")) {
      return ok("kube-system");
    }
    if (
      command === "kubectl" &&
      args.includes("get") &&
      args.includes("secret") &&
      args.includes("reference-app")
    ) {
      return ok(this.sourceExists ? "secret/reference-app\n" : "");
    }
    return ok("");
  }
  sourceApplies(): Source[] {
    return this.calls
      .filter(
        ({ command, args, options }) =>
          command === "kubectl" &&
          args.includes("apply") &&
          options?.input?.startsWith("{") &&
          JSON.parse(options.input).metadata?.name === "reference-app",
      )
      .map(({ options }) => JSON.parse(options!.input!) as Source);
  }
}

async function checkout(): Promise<{ root: string; tokenPath: string }> {
  const root = await mkdtemp(join(tmpdir(), "kore-token-owner-"));
  await mkdir(join(root, "infra/environments/local/secrets"), {
    recursive: true,
  });
  await mkdir(join(root, ".kore/state"), { recursive: true });
  return { root, tokenPath: join(root, ".kore/state/reference-api-token") };
}

test("a checkout never overwrites a token source that already exists in the cluster", async () => {
  const base = await loadRepository("local");
  const { root, tokenPath } = await checkout();
  try {
    const runner = new SourceRunner(true);
    await syncLocalSecrets({ ...base, root }, runner);
    assert.equal(runner.sourceApplies().length, 0);
    await assert.rejects(stat(tokenPath), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a checkout whose local token differs from the cluster still leaves the source alone", async () => {
  const base = await loadRepository("local");
  const { root, tokenPath } = await checkout();
  try {
    await writeFile(tokenPath, `${"b".repeat(64)}\n`, { mode: 0o600 });
    const runner = new SourceRunner(true);
    await syncLocalSecrets({ ...base, root }, runner);
    assert.equal(runner.sourceApplies().length, 0);
    assert.equal((await readFile(tokenPath, "utf8")).trim(), "b".repeat(64));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("creating the source records a rotation id that is not the token", async () => {
  const base = await loadRepository("local");
  const { root, tokenPath } = await checkout();
  try {
    const runner = new SourceRunner(false);
    await syncLocalSecrets({ ...base, root }, runner);
    const [source] = runner.sourceApplies();
    const token = (await readFile(tokenPath, "utf8")).trim();
    const id = source?.metadata.annotations?.[rotationAnnotation];
    assert.match(id ?? "", /^[a-f0-9]{16}$/);
    assert.equal(token.includes(id!), false);
    assert.match(
      source?.metadata.annotations?.["platform.kore.dev/rotated-at"] ?? "",
      /^\d{4}-\d\d-\d\dT[\d:.]+Z$/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rotation replaces the existing source with a new token and a new rotation id", async () => {
  const base = await loadRepository("local");
  const { root, tokenPath } = await checkout();
  try {
    await writeFile(tokenPath, `${"b".repeat(64)}\n`, { mode: 0o600 });
    const runner = new SourceRunner(true);
    await syncLocalSecrets({ ...base, root }, runner, {
      rotate: true,
      yes: true,
    });
    const token = (await readFile(tokenPath, "utf8")).trim();
    assert.match(token, /^[a-f0-9]{64}$/);
    assert.notEqual(token, "b".repeat(64));
    assert.equal((await stat(tokenPath)).mode & 0o777, 0o600);
    const [source] = runner.sourceApplies();
    assert.equal(source?.data.API_TOKEN, Buffer.from(token).toString("base64"));
    assert.match(
      source?.metadata.annotations?.[rotationAnnotation] ?? "",
      /^[a-f0-9]{16}$/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rotation without consent fails before any command runs or token changes", async () => {
  const base = await loadRepository("local");
  const { root, tokenPath } = await checkout();
  try {
    const runner = new SourceRunner(true);
    await assert.rejects(
      syncLocalSecrets({ ...base, root }, runner, { rotate: true }),
      /--yes/,
    );
    assert.equal(runner.calls.length, 0);
    await assert.rejects(stat(tokenPath), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
