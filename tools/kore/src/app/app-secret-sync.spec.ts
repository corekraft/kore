import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import { loadRepository } from "../config/index.js";
import type { RunOptions, RunResult, Runner } from "../runtime/index.js";
import { waitForSecretSource } from "./readiness.js";

const rotationId = "0123456789abcdef";
const rotatedAt = "2026-11-09T10:00:00.400Z";
const version = createHash("sha256")
  .update(rotationId)
  .digest("hex")
  .slice(0, 16);
const stale = "2026-11-09T09:59:59Z|True|SecretSynced";
const fresh = "2026-11-09T10:00:05Z|True|SecretSynced";

class SyncRunner implements Runner {
  calls: { command: string; args: readonly string[]; options?: RunOptions }[] =
    [];
  private probes = 0;
  constructor(
    private readonly source: string,
    private readonly externalSecret: (probe: number) => string,
  ) {}
  async run(
    command: string,
    args: readonly string[],
    options?: RunOptions,
  ): Promise<RunResult> {
    this.calls.push({ command, args, ...(options ? { options } : {}) });
    const ok = (stdout: string): RunResult => ({ stdout, stderr: "", code: 0 });
    if (args.includes("secret")) {
      return ok(this.source);
    }
    if (args.includes("externalsecret") && args.includes("get")) {
      return ok(this.externalSecret(this.probes++));
    }
    return ok("");
  }
  annotations(): string[][] {
    return this.calls
      .filter(({ args }) => args.includes("annotate"))
      .map(({ args }) => [...args]);
  }
}

const fast = { timeoutMs: 300, intervalMs: 5 };

test("a Secret already synced after the rotation is not resynced", async () => {
  const repository = await loadRepository("local");
  const runner = new SyncRunner(`${rotationId}|${rotatedAt}`, () => fresh);
  expect(await waitForSecretSource(repository, runner, "reference", fast)).toBe(
    version,
  );
  expect(runner.annotations()).toEqual([]);
});

test("a stale Secret is resynced through the ExternalSecret and awaited before returning", async () => {
  const repository = await loadRepository("local");
  const runner = new SyncRunner(`${rotationId}|${rotatedAt}`, (probe) =>
    probe < 3 ? stale : fresh,
  );
  expect(await waitForSecretSource(repository, runner, "reference", fast)).toBe(
    version,
  );
  const [annotate, ...more] = runner.annotations();
  expect(more).toEqual([]);
  expect(annotate).toContain("externalsecret");
  expect(annotate).toContain("reference-app");
  expect(annotate?.some((arg) => arg.startsWith("force-sync="))).toBe(true);
  expect(annotate?.[annotate.indexOf("--namespace") + 1]).toBe("reference");
});

test("a Secret that never syncs fails naming the ExternalSecret and its condition", async () => {
  const repository = await loadRepository("local");
  const runner = new SyncRunner(
    `${rotationId}|${rotatedAt}`,
    () => "2026-11-09T09:59:59Z|False|SecretSyncedError",
  );
  await expect(
    waitForSecretSource(repository, runner, "reference", fast),
  ).rejects.toThrow(
    /ExternalSecret reference\/reference-app.*Ready=False.*SecretSyncedError/s,
  );
});

test("a source with no rotation id waits for nothing", async () => {
  const repository = await loadRepository("local");
  const runner = new SyncRunner("|", () => stale);
  expect(await waitForSecretSource(repository, runner, "reference", fast)).toBe(
    "",
  );
  expect(runner.calls.some(({ args }) => args.includes("externalsecret"))).toBe(
    false,
  );
});

test("the wait reads only metadata and status, never secret data", async () => {
  const repository = await loadRepository("local");
  const runner = new SyncRunner(`${rotationId}|${rotatedAt}`, () => fresh);
  await waitForSecretSource(repository, runner, "reference", fast);
  for (const { args } of runner.calls) {
    const joined = args.join(" ");
    expect(joined).not.toMatch(
      /\.data|-o ?(yaml|json)\b|--output[ =](yaml|json)\b/,
    );
    expect(joined).toMatch(/metadata\.annotations|status\./);
  }
});
