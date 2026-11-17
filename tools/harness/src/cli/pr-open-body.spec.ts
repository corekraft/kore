import { describe, expect, it, vi } from "vitest";
import { readPrBody } from "./pr-open-body.js";

function reader(text = "Summary.\n") {
  const readFile = vi.fn<(path: string) => Promise<string>>();
  readFile.mockResolvedValue(text);
  return { fs: { readFile }, cwd: "/work" };
}

const withCode = (code: string) =>
  Object.assign(new Error(`${code}: failed`), { code });

describe("readPrBody returns the body the command posts", () => {
  it("returns the --body text, and reads no file, when --body-file is not given", async () => {
    const source = reader();
    expect(
      await readPrBody({ inline: "Summary.", file: undefined }, source),
    ).toBe("Summary.");
    expect(source.fs.readFile).not.toHaveBeenCalled();
  });

  it("returns an empty body when neither flag is given", async () => {
    const source = reader();
    expect(
      await readPrBody({ inline: undefined, file: undefined }, source),
    ).toBe("");
  });

  it("returns the file's exact text, reading the path from the working directory", async () => {
    const source = reader("Summary.\n\nDetail line.\n");
    expect(
      await readPrBody({ inline: undefined, file: "body.md" }, source),
    ).toBe("Summary.\n\nDetail line.\n");
    expect(source.fs.readFile).toHaveBeenCalledWith("/work/body.md");
  });

  it("reads the file when --body is given as an empty value", async () => {
    const source = reader("From the file.\n");
    expect(await readPrBody({ inline: "", file: "body.md" }, source)).toBe(
      "From the file.\n",
    );
  });
});

describe("readPrBody refuses a body source it cannot use", () => {
  it("refuses --body with --body-file, naming both, without reading the file", async () => {
    const source = reader();
    await expect(
      readPrBody({ inline: "Summary.", file: "body.md" }, source),
    ).rejects.toMatchObject({
      message:
        "--body and --body-file together are refused. Pass the text with --body <summary> or the path with --body-file <path>, not both.",
    });
    expect(source.fs.readFile).not.toHaveBeenCalled();
  });

  it("refuses --body-file with no path, without reading anything", async () => {
    const source = reader();
    await expect(
      readPrBody({ inline: undefined, file: "" }, source),
    ).rejects.toMatchObject({
      message:
        "--body-file needs the path to a file that holds the body. Write the body with the Write tool, then pass its path as --body-file <path>.",
    });
    expect(source.fs.readFile).not.toHaveBeenCalled();
  });

  it("refuses a missing file, naming its path and the fix", async () => {
    const source = reader();
    source.fs.readFile.mockRejectedValue(withCode("ENOENT"));
    await expect(
      readPrBody({ inline: undefined, file: "body.md" }, source),
    ).rejects.toMatchObject({
      message:
        "--body-file body.md does not exist. Write the body to that path with the Write tool, then rerun `harness pr open`.",
    });
  });

  it("refuses an unreadable file, naming its path, the error and the fix", async () => {
    const source = reader();
    source.fs.readFile.mockRejectedValue(withCode("EACCES"));
    await expect(
      readPrBody({ inline: undefined, file: "body.md" }, source),
    ).rejects.toMatchObject({
      message:
        "--body-file body.md cannot be read (EACCES). Make the file readable or write the body to it again with the Write tool, then rerun `harness pr open`.",
    });
  });

  it("refuses a file that holds only whitespace as empty, naming its path and the fix", async () => {
    const source = reader("  \n\n");
    await expect(
      readPrBody({ inline: undefined, file: "body.md" }, source),
    ).rejects.toMatchObject({
      message:
        "--body-file body.md is empty. Write the body into it with the Write tool, then rerun `harness pr open`.",
    });
  });

  it("rethrows a read failure that is neither missing nor unreadable", async () => {
    const source = reader();
    const ioError = withCode("EIO");
    source.fs.readFile.mockRejectedValue(ioError);
    await expect(
      readPrBody({ inline: undefined, file: "body.md" }, source),
    ).rejects.toBe(ioError);
  });
});
