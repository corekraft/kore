// Fakes shared by the runtime domain's unit specs. A support file is not a unit,
// so it needs no spec of its own (ADR 0098).
import type { FileHandle } from "node:fs/promises";
import { vi } from "vitest";
import type { Runner } from "./runner.js";

export type Run = Runner["run"];

/**
 * A typed runner that records every call. It replies with `exit 0` and no
 * output unless `reply` says otherwise.
 */
export function fakeRunner(
  reply: Run = async () => ({ stdout: "", stderr: "", code: 0 }),
) {
  const run = vi.fn<Run>(reply);
  return { runner: { run } as Runner, run };
}

/** An open file handle whose `close` and `writeFile` a test can read. */
export function fakeHandle() {
  const close = vi.fn<() => Promise<void>>(async () => undefined);
  const writeFile = vi.fn<(data: string) => Promise<void>>(
    async () => undefined,
  );
  return {
    close,
    writeFile,
    handle: { close, writeFile } as unknown as FileHandle,
  };
}

export type FakeHandle = ReturnType<typeof fakeHandle>;

/** A Node system error carrying a code, as a failed fs or process call throws. */
export function systemError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}
