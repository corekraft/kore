import { describe, expect, it, vi } from "vitest";
import type { ChangedFile } from "./diff.js";
import { codeLineCount } from "./code-lines.js";
import { lengthAudit } from "./file-length.js";
import type { Api } from "./manifest-source.js";

// The count is the lint's (code-lines.ts); here it is mocked, so each test states the count it reads.
vi.mock("./code-lines.js");

const REPO = "corekraft/kore";
const HEAD = "abc1234def5678abc1234def5678abc1234def56";
const FIX =
  "split it into smaller modules, or move a fixture only one spec uses into a <name>-support.ts beside it (docs/guides/contributor.md)";

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

/** An api that answers each contents read with the text of the file it names. */
function apiWith(texts: Record<string, string>): Api {
  return vi.fn<Api>(async (args) => {
    const path = args.at(-1)?.replace(/^repos\/.*\/contents\//, "") ?? "";
    return texts[path.replace(/\?ref=.*$/, "")] ?? "";
  });
}

describe("lengthAudit reports a changed file over the lint's limit, and no other", () => {
  it("names the file, its count and the fix for a file over 300 code lines", async () => {
    vi.mocked(codeLineCount).mockReturnValue(301);
    const api = apiWith({ "tools/harness/src/judge/big.ts": "x" });
    expect(
      await lengthAudit(api, REPO, HEAD, [
        changed("tools/harness/src/judge/big.ts"),
      ]),
    ).toEqual([
      {
        item: "file-length",
        file: "tools/harness/src/judge/big.ts",
        detail: "301 non-blank, non-comment lines; the limit is 300",
        fix: FIX,
      },
    ]);
  });

  it("produces no finding for a file at the limit of 300 code lines", async () => {
    vi.mocked(codeLineCount).mockReturnValue(300);
    const api = apiWith({ "tools/harness/src/judge/edge.spec.ts": "x" });
    expect(
      await lengthAudit(api, REPO, HEAD, [
        changed("tools/harness/src/judge/edge.spec.ts"),
      ]),
    ).toEqual([]);
  });

  it("counts the head text of each file, so a file the lint passes is not flagged from its raw line count", async () => {
    vi.mocked(codeLineCount).mockReturnValue(290);
    const raw = "line\n".repeat(315);
    const api = apiWith({ "tools/kore/src/platform/a.ts": raw });
    expect(
      await lengthAudit(api, REPO, HEAD, [
        changed("tools/kore/src/platform/a.ts"),
      ]),
    ).toEqual([]);
    expect(codeLineCount).toHaveBeenCalledWith(raw);
  });
});

describe("lengthAudit reads only the files the lint reads, at the head commit", () => {
  it("reads only the in-scope .ts files at the head commit, and names each one it flags", async () => {
    vi.mocked(codeLineCount).mockReturnValue(400);
    const api = apiWith({
      "tools/harness/integration/cli/a.ts": "a",
      "tools/kore/integration/b.ts": "b",
    });
    const findings = await lengthAudit(api, REPO, HEAD, [
      changed("tools/harness/integration/cli/a.ts"),
      changed("tools/harness/src/guide.mjs"),
      changed("docs/guides/contributor.md"),
      changed("infra/environments/local/values.yaml"),
      changed("tools/harness/src/gone.ts", true),
      changed("tools/kore/integration/b.ts"),
    ]);
    expect(vi.mocked(api).mock.calls.map(([args]) => args)).toEqual([
      [
        "api",
        "-H",
        "Accept: application/vnd.github.raw",
        `repos/${REPO}/contents/tools/harness/integration/cli/a.ts?ref=${HEAD}`,
      ],
      [
        "api",
        "-H",
        "Accept: application/vnd.github.raw",
        `repos/${REPO}/contents/tools/kore/integration/b.ts?ref=${HEAD}`,
      ],
    ]);
    expect(findings.map((f) => f.file)).toEqual([
      "tools/harness/integration/cli/a.ts",
      "tools/kore/integration/b.ts",
    ]);
  });

  it("reads nothing and reports nothing for a diff with no in-scope file", async () => {
    const api = apiWith({});
    expect(
      await lengthAudit(api, REPO, HEAD, [changed("docs/index.md")]),
    ).toEqual([]);
    expect(api).not.toHaveBeenCalled();
  });

  it("lets a failed read reach the caller, so the gh error is not reported as a clean file", async () => {
    const api = vi.fn<Api>(async () => {
      throw new Error("gh api failed");
    });
    await expect(
      lengthAudit(api, REPO, HEAD, [changed("tools/harness/src/a.ts")]),
    ).rejects.toThrow("gh api failed");
  });
});
