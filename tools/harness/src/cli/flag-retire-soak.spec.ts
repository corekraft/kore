// Docs: docs/decisions/0149-a-feature-flag-retires-after-it-soaks-on-in-every-environment-it-applies-to.md
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FlagError } from "../flag/index.js";
import { parseHarnessConfig } from "../flow/index.js";
import type { FileSystem } from "../runtime/index.js";
import { readRetireSoakDays } from "./flag-retire-soak.js";

vi.mock("../flow/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../flow/index.js")>()),
  parseHarnessConfig: vi.fn(),
}));

const BASE = "/repo";
const CONFIG = `${BASE}/.claude/harness.json`;

/** A file system whose harness config reads as the given text, or fails with the given error. */
function fsReading(result: string | Error) {
  const readFile = vi.fn(() =>
    typeof result === "string"
      ? Promise.resolve(result)
      : Promise.reject(result),
  );
  return { fs: { readFile } as unknown as FileSystem, readFile };
}

beforeEach(() => {
  vi.mocked(parseHarnessConfig).mockReturnValue({
    cost: {} as never,
    retireSoakDays: 14,
  });
});

describe("readRetireSoakDays", () => {
  it("reads the soak from the harness config at the repository root, as the harness config parser reads it", async () => {
    const { fs, readFile } = fsReading("CONFIG TEXT");
    expect(await readRetireSoakDays(fs, BASE)).toBe(14);
    expect(readFile).toHaveBeenCalledWith(CONFIG);
    expect(parseHarnessConfig).toHaveBeenCalledWith(
      "CONFIG TEXT",
      ".claude/harness.json",
    );
  });

  it("refuses a harness config that cannot be read, naming the file and the cause", async () => {
    const { fs } = fsReading(new Error("ENOENT"));
    await expect(readRetireSoakDays(fs, BASE)).rejects.toThrow(FlagError);
    await expect(readRetireSoakDays(fs, BASE)).rejects.toThrow(
      "Cannot read .claude/harness.json (ENOENT); the retirement soak is configured there (ADR 0149). Restore it, then rerun.",
    );
  });

  it("refuses a harness config the parser rejects, with the parser's own message", async () => {
    vi.mocked(parseHarnessConfig).mockReturnValue({
      error:
        'Invalid .claude/harness.json: key "retireSoakDays" must be a whole number of days, at least 0 (ADR 0149). Fix the value.',
    });
    const { fs } = fsReading("CONFIG TEXT");
    await expect(readRetireSoakDays(fs, BASE)).rejects.toThrow(
      'Invalid .claude/harness.json: key "retireSoakDays" must be a whole number of days, at least 0 (ADR 0149). Fix the value.',
    );
  });

  it("refuses a harness config that leaves the soak out, so no flag retires on a guessed one", async () => {
    vi.mocked(parseHarnessConfig).mockReturnValue({ cost: {} as never });
    const { fs } = fsReading("CONFIG TEXT");
    await expect(readRetireSoakDays(fs, BASE)).rejects.toThrow(
      ".claude/harness.json must set retireSoakDays, the soak in whole days a retired feature flag needs first (ADR 0149). Set it, then rerun.",
    );
  });
});
