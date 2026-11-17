import { describe, expect, it, vi } from "vitest";
import { readTextOption, type TextOption } from "./text-option.js";

const REASON: TextOption = {
  name: "reason",
  value: "<why>",
  noun: "reason",
  rerun: "`harness judge send-back 42`",
};

const SOURCE = { cwd: "/work" };

/** A file system whose readFile resolves to the given text, or rejects with the given error. */
function filesystem(result: string | NodeJS.ErrnoException) {
  const readFile = vi.fn<(path: string) => Promise<string>>();
  if (typeof result === "string") {
    readFile.mockResolvedValue(result);
  } else {
    readFile.mockRejectedValue(result);
  }
  return { readFile };
}

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

describe("readTextOption: the inline option alone", () => {
  it("gives the inline text unchanged and reads no file", async () => {
    const fs = filesystem("unused");

    const read = await readTextOption(
      REASON,
      { inline: "too slow", file: undefined },
      { ...SOURCE, fs },
    );

    expect(read).toEqual({ text: "too slow" });
    expect(fs.readFile).not.toHaveBeenCalled();
  });

  it("gives an empty text when neither option is given, so the caller names the missing text", async () => {
    const fs = filesystem("unused");

    const read = await readTextOption(
      REASON,
      { inline: undefined, file: undefined },
      { ...SOURCE, fs },
    );

    expect(read).toEqual({ text: "" });
    expect(fs.readFile).not.toHaveBeenCalled();
  });

  it("treats an empty inline value as not given", async () => {
    const fs = filesystem("unused");

    const read = await readTextOption(
      REASON,
      { inline: "", file: undefined },
      { ...SOURCE, fs },
    );

    expect(read).toEqual({ text: "" });
  });
});

describe("readTextOption: the file option alone", () => {
  it("gives the file's text exactly as the file holds it, read from the working directory", async () => {
    const fs = filesystem("Too slow.\n\nSee the log.\n");

    const read = await readTextOption(
      REASON,
      { inline: undefined, file: "reason.md" },
      { ...SOURCE, fs },
    );

    expect(read).toEqual({ text: "Too slow.\n\nSee the log.\n" });
    expect(fs.readFile).toHaveBeenCalledWith("/work/reason.md");
  });
});

describe("readTextOption: a file option that cannot be read", () => {
  it("refuses a file option with no path, naming the flag and the fix, and reads nothing", async () => {
    const fs = filesystem("unused");

    const read = await readTextOption(
      REASON,
      { inline: undefined, file: true },
      { ...SOURCE, fs },
    );

    expect(read).toEqual({
      error:
        "--reason-file needs the path to a file that holds the reason. Write the reason with the Write tool, then pass its path as --reason-file <path>.",
    });
    expect(fs.readFile).not.toHaveBeenCalled();
  });

  it("refuses a missing file with its path and the fix", async () => {
    const fs = filesystem(errno("ENOENT"));

    const read = await readTextOption(
      REASON,
      { inline: undefined, file: "missing.md" },
      { ...SOURCE, fs },
    );

    expect(read).toEqual({
      error:
        "--reason-file missing.md does not exist. Write the reason to that path with the Write tool, then rerun `harness judge send-back 42`.",
    });
  });

  it.each(["EACCES", "EPERM", "EISDIR"])(
    "refuses a file that cannot be read (%s) with its path, the code and the fix",
    async (code) => {
      const fs = filesystem(errno(code));

      const read = await readTextOption(
        REASON,
        { inline: undefined, file: "reason.md" },
        { ...SOURCE, fs },
      );

      expect(read).toEqual({
        error: `--reason-file reason.md cannot be read (${code}). Make the file readable or write the reason to it again with the Write tool, then rerun \`harness judge send-back 42\`.`,
      });
    },
  );

  it("refuses a file that holds only whitespace as empty, with its path and the fix", async () => {
    const fs = filesystem(" \n\t\n");

    const read = await readTextOption(
      REASON,
      { inline: undefined, file: "reason.md" },
      { ...SOURCE, fs },
    );

    expect(read).toEqual({
      error:
        "--reason-file reason.md is empty. Write the reason into it with the Write tool, then rerun `harness judge send-back 42`.",
    });
  });

  it("rethrows an error it does not expect, rather than naming it as a refusal", async () => {
    const fs = filesystem(errno("EIO"));

    await expect(
      readTextOption(
        REASON,
        { inline: undefined, file: "reason.md" },
        { ...SOURCE, fs },
      ),
    ).rejects.toMatchObject({ code: "EIO" });
  });
});

describe("readTextOption: both options together", () => {
  it("refuses the inline and file options together, naming both, and reads no file", async () => {
    const fs = filesystem("unused");

    const read = await readTextOption(
      REASON,
      { inline: "too slow", file: "reason.md" },
      { ...SOURCE, fs },
    );

    expect(read).toEqual({
      error:
        "--reason and --reason-file together are refused. Pass the text with --reason <why> or the path with --reason-file <path>, not both.",
    });
    expect(fs.readFile).not.toHaveBeenCalled();
  });
});
