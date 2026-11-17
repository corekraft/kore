import { expect, vi } from "vitest";
import type { CommandContext } from "../runtime/index.js";

export const URL = "https://github.com/corekraft/kore/pull/9";
export const WRITER_ENV = { KORE_ROLE: "writer", KORE_AGENT: "fix-x" };

export const REQUIRED = {
  title: "feat: add pr open",
  body: "Summary.",
  pattern: "no-behaviour-change",
};

export const refusedWith = (fragment: string) =>
  expect.objectContaining({
    message: expect.stringContaining(fragment) as unknown,
  });

/** A command context whose gh runner, body file and output are all mocks. */
export function fixture(
  options: Record<string, string | boolean>,
  json = false,
  env: Record<string, string | undefined> = WRITER_ENV,
) {
  const run = vi.fn();
  run.mockResolvedValue({ code: 0, stdout: `${URL}\n`, stderr: "" });
  const readFile = vi.fn<(path: string) => Promise<string>>();
  readFile.mockResolvedValue("Summary.\n");
  const stdout = vi.fn<(text: string) => void>();
  const stderr = vi.fn<(text: string) => void>();
  const context = {
    options,
    json,
    deps: {
      runner: { run },
      root: () => Promise.resolve("/repo"),
      fs: { readFile },
      cwd: "/work",
      stdout,
      stderr,
      env,
    },
  } as unknown as CommandContext;
  return { context, run, readFile, stdout, stderr };
}
