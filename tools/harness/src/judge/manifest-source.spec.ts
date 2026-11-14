import { describe, expect, it, vi } from "vitest";
import type { ChangedFile } from "./diff.js";
import { manifestSides, withManifestSides } from "./manifest-source.js";

const REPO = "corekraft/kore";
const BASE = "1111111";
const HEAD = "2222222";
const MERGE_BASE = "3333333";
const MANIFEST = "tools/kore/package.json";

/** A fake `gh api`: the merge base for the compare call, and the file's text at each commit. */
const fakeApi = (texts: Record<string, string>) =>
  vi.fn(async (args: readonly string[]) => {
    if (args.some((a) => a.includes("/compare/"))) {
      return `${MERGE_BASE}\n`;
    }
    const ref = /\?ref=(\w+)$/.exec(args.at(-1) ?? "")?.[1] ?? "";
    return texts[ref] ?? "";
  });

const changed = (path: string, deleted = false): ChangedFile => ({
  path,
  previousPath: path,
  deleted,
  added: [],
  removed: 0,
  netRemoved: 0,
  after: [],
  trail: [],
});

describe("manifestSides", () => {
  it("reads the manifest at the merge base and at the head, not at the base tip", async () => {
    const api = fakeApi({ [MERGE_BASE]: "before", [HEAD]: "after" });
    await expect(manifestSides(api, REPO, BASE, HEAD)).resolves.toEqual({
      before: "before",
      after: "after",
    });
    expect(api).toHaveBeenNthCalledWith(1, [
      "api",
      `repos/${REPO}/compare/${BASE}...${HEAD}`,
      "--jq",
      ".merge_base_commit.sha",
    ]);
    expect(api).toHaveBeenNthCalledWith(2, [
      "api",
      "-H",
      "Accept: application/vnd.github.raw",
      `repos/${REPO}/contents/${MANIFEST}?ref=${MERGE_BASE}`,
    ]);
    expect(api).toHaveBeenNthCalledWith(3, [
      "api",
      "-H",
      "Accept: application/vnd.github.raw",
      `repos/${REPO}/contents/${MANIFEST}?ref=${HEAD}`,
    ]);
  });
});

describe("manifestSides, when a read fails", () => {
  it("lets the rejection of the compare read reach the caller, with no manifest read after it", async () => {
    const api = vi.fn(async () => {
      throw new Error("compare failed");
    });
    await expect(manifestSides(api, REPO, BASE, HEAD)).rejects.toThrow(
      "compare failed",
    );
    expect(api).toHaveBeenCalledTimes(1);
  });

  it("lets the rejection of the head read reach the caller, and returns no sides", async () => {
    const api = vi.fn(async (args: readonly string[]) => {
      if (args.at(-1)?.endsWith(`?ref=${HEAD}`)) {
        throw new Error("head read failed");
      }
      return args.some((a) => a.includes("/compare/"))
        ? `${MERGE_BASE}\n`
        : "before";
    });
    await expect(manifestSides(api, REPO, BASE, HEAD)).rejects.toThrow(
      "head read failed",
    );
  });
});

describe("withManifestSides, when the compare read fails", () => {
  it("rejects without attaching sides, and makes no further call", async () => {
    const api = vi.fn(async () => {
      throw new Error("compare failed");
    });
    await expect(
      withManifestSides([changed(MANIFEST)], api, REPO, BASE, HEAD),
    ).rejects.toThrow("compare failed");
    expect(api).toHaveBeenCalledTimes(1);
  });
});

describe("withManifestSides", () => {
  it("attaches the sides to the manifest and leaves every other file as it was", async () => {
    const api = fakeApi({ [MERGE_BASE]: "before", [HEAD]: "after" });
    const other = changed("docs/index.md");
    const manifest = changed(MANIFEST);
    const result = await withManifestSides(
      [other, manifest],
      api,
      REPO,
      BASE,
      HEAD,
    );
    expect(result).toEqual([
      other,
      { ...manifest, sides: { before: "before", after: "after" } },
    ]);
  });

  it("makes no API call when the diff does not touch the manifest", async () => {
    const api = fakeApi({});
    const files = [changed("docs/index.md")];
    await expect(
      withManifestSides(files, api, REPO, BASE, HEAD),
    ).resolves.toEqual(files);
    expect(api).not.toHaveBeenCalled();
  });

  it("leaves a deleted manifest without sides, since it has no head text to read", async () => {
    const api = fakeApi({});
    const deleted = changed(MANIFEST, true);
    await expect(
      withManifestSides([deleted], api, REPO, BASE, HEAD),
    ).resolves.toEqual([deleted]);
    expect(api).not.toHaveBeenCalled();
  });
});
