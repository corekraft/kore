import { beforeEach, describe, expect, it } from "vitest";
import { fakeFileSystem, type FakeFileSystem } from "./deps-support.js";
import { briefOperand, INLINE_BRIEF_BYTES } from "./spawn-hc-brief.js";

let fs: FakeFileSystem;

beforeEach(() => {
  fs = fakeFileSystem();
  fs.writeFile.mockResolvedValue(undefined);
});

describe("briefOperand passes a brief that fits one argv element unchanged", () => {
  it("returns a brief with quotes and newlines as it is, writing no file", async () => {
    const brief = 'Say "hello"\nthen stop; $HOME is not expanded.';

    await expect(
      briefOperand(fs, "/main", "image-trust-writer", brief),
    ).resolves.toBe(brief);
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it("keeps a brief of exactly the limit inline", async () => {
    const brief = "a".repeat(INLINE_BRIEF_BYTES);

    await expect(
      briefOperand(fs, "/main", "image-trust-writer", brief),
    ).resolves.toBe(brief);
    expect(fs.writeFile).not.toHaveBeenCalled();
  });
});

describe("briefOperand moves a brief over the limit to a file the operand names", () => {
  it.each([
    ["one byte over, in ASCII", "a".repeat(INLINE_BRIEF_BYTES + 1)],
    [
      "over the limit in two-byte characters",
      "\u00e9".repeat(INLINE_BRIEF_BYTES / 2 + 1),
    ],
  ])(
    "writes the brief to .kore/brief under the main checkout when it is %s",
    async (_, brief) => {
      const operand = await briefOperand(
        fs,
        "/main",
        "image-trust-writer",
        brief,
      );

      expect(fs.writeFile).toHaveBeenCalledExactlyOnceWith(
        "/main/.kore/brief/image-trust-writer.md",
        brief,
      );
      expect(operand).toBe(
        "Your brief is longer than one command line can carry, so it is in /main/.kore/brief/image-trust-writer.md. Read that file in full and do the work it describes.",
      );
    },
  );
});
